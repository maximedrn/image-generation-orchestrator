import { describe, expect, test } from "bun:test";
import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import type { DatabaseServiceShape } from "@app/infrastructure/database/database.types";
import { createJobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import type { DispatcherWorkerDependencies } from "@app/infrastructure/dispatcher/dispatcher.types";
import { pollRemoteJob } from "@app/infrastructure/dispatcher/stages/dispatcher-poll.service";
import { EngineJobStatus } from "@app/infrastructure/engine/engine.constants";
import type {
  EngineGatewayShape,
  EnginePoolShape,
} from "@app/infrastructure/engine/engine.interface";
import type {
  EngineCapabilities,
  EngineJob,
  EngineReservation,
  EngineSubmission,
  EngineView,
} from "@app/infrastructure/engine/engine.types";
import type {
  ResultStorageShape,
  StoredResult,
} from "@app/infrastructure/storage/storage.interface";
import type { JobRepositoryShape } from "@app/modules/jobs/job.interface";
import type {
  Job,
  JobCreateRequest,
  JobResult,
} from "@app/modules/jobs/job.types";
import {
  createJobFixture,
  createPlatformConfigFixture,
  createTestDatabase,
  getFirstEngineFixture,
  TestIdentifier,
} from "@test/fixtures/platform.fixture";
import { TestInstant } from "@test/fixtures/test.constants";
import { Effect, Option } from "effect";

/** Upstream calls observed by the polling ownership test. */
interface PollGatewayCounters {
  cancelCalls: number;
  pollCalls: number;
  submitCalls: number;
}

/** Counting gateway stub returned by the polling gateway factory. */
interface CountingGatewayFixture {
  readonly counters: PollGatewayCounters;
  readonly gateway: EngineGatewayShape;
}

/**
 * Creates a gateway that counts every operation and should remain untouched.
 *
 * @returns {{gateway: EngineGatewayShape; counters: PollGatewayCounters}} Gateway fixture.
 */
const createCountingGateway = (): CountingGatewayFixture => {
  const counters: PollGatewayCounters = {
    cancelCalls: 0,
    pollCalls: 0,
    submitCalls: 0,
  };
  const unexpectedJob: EngineJob = {
    error: null,
    id: "unexpected-remote",
    result: null,
    status: EngineJobStatus.running,
  };
  const gateway: EngineGatewayShape = {
    cancel: (): Effect.Effect<EngineJob> => {
      counters.cancelCalls += 1;
      return Effect.succeed(unexpectedJob);
    },
    capabilities: (): Effect.Effect<EngineCapabilities> =>
      Effect.succeed({ outputFormats: [], supportsImageGeneration: true }),
    poll: (): Effect.Effect<EngineJob> => {
      counters.pollCalls += 1;
      return Effect.succeed(unexpectedJob);
    },
    submit: (
      _engine: EngineConfig,
      _request: JobCreateRequest,
    ): Effect.Effect<EngineSubmission> => {
      counters.submitCalls += 1;
      return Effect.succeed({ id: "unexpected-remote" });
    },
  };
  return { counters, gateway };
};

/** Scheduler and storage ports the polling scenario must never exercise. */
interface PollAdapters {
  readonly pool: EnginePoolShape;
  readonly storage: ResultStorageShape;
}

/**
 * Creates no-op scheduler and storage ports unused by an ownership-stop poll.
 *
 * @param {EngineConfig} engine - Engine included in the scheduler reservation.
 * @returns {{pool: EnginePoolShape; storage: ResultStorageShape}} Adapter fixtures.
 */
const createUnusedAdapters = (engine: EngineConfig): PollAdapters => {
  const reservation: EngineReservation = { engine };
  const pool: EnginePoolShape = {
    list: (): Effect.Effect<readonly EngineView[]> => Effect.succeed([]),
    recordFailure: (): Effect.Effect<void> => Effect.void,
    recordSuccess: (): Effect.Effect<void> => Effect.void,
    release: (): Effect.Effect<void> => Effect.void,
    reserve: (): Effect.Effect<Option.Option<EngineReservation>> =>
      Effect.succeed(Option.some(reservation)),
    reserveById: (): Effect.Effect<Option.Option<EngineReservation>> =>
      Effect.succeed(Option.some(reservation)),
  };
  const storage: ResultStorageShape = {
    read: (metadata: JobResult): Effect.Effect<StoredResult> =>
      Effect.succeed({ metadata, stream: new ReadableStream<Uint8Array>() }),
    remove: (): Effect.Effect<void> => Effect.void,
    writeBase64: (): Effect.Effect<JobResult> =>
      Effect.die("storage must not be called after lease ownership is lost"),
  };
  return { pool, storage };
};

/**
 * Creates one durable remote-bound running job for polling tests.
 *
 * @param {JobRepositoryShape} repository - In-memory repository.
 * @returns {Promise<Job>} Bound running fixture.
 */
const createBoundJob = async (repository: JobRepositoryShape): Promise<Job> => {
  const queued: Job = createJobFixture("poll-ownership-job");
  await Effect.runPromise(repository.createIfCapacity(queued, 10));
  await Effect.runPromise(
    repository.claim(queued.id, TestInstant.leaseRenewed, 1),
  );
  const bound: Option.Option<Job> = await Effect.runPromise(
    repository.bindRemote(
      queued.id,
      TestIdentifier.engine,
      TestIdentifier.remoteJob,
      TestInstant.leaseRenewed,
    ),
  );
  if (Option.isNone(bound)) {
    throw new Error("polling fixture could not bind the remote job");
  }
  return bound.value;
};

describe("dispatcher polling ownership", (): void => {
  test("stops before any upstream call when lease renewal loses ownership", async (): Promise<void> => {
    const database: DatabaseServiceShape = createTestDatabase();
    const baseRepository: JobRepositoryShape = createJobRepository(
      database.database,
    );
    const job: Job = await createBoundJob(baseRepository);
    const repository: JobRepositoryShape = {
      ...baseRepository,
      renewLease: (): Effect.Effect<boolean> => Effect.succeed(false),
    };
    const config: PlatformConfig = {
      ...createPlatformConfigFixture("/tmp/dispatcher-poll"),
      queue: {
        ...createPlatformConfigFixture("/tmp/dispatcher-poll").queue,
        pollIntervalMs: 1,
      },
    };
    const engine: EngineConfig = getFirstEngineFixture(config);
    const gatewayFixture: CountingGatewayFixture = createCountingGateway();
    const adapters: PollAdapters = createUnusedAdapters(engine);
    const dependencies: DispatcherWorkerDependencies = {
      config,
      gateway: gatewayFixture.gateway,
      pool: adapters.pool,
      repository,
      storage: adapters.storage,
    };
    await Effect.runPromise(
      pollRemoteJob(
        job,
        {
          consecutiveFailures: 0,
          engine,
          remoteJobId: TestIdentifier.remoteJob,
        },
        dependencies,
      ),
    );
    database.client.close();
    expect(gatewayFixture.counters.submitCalls).toBe(0);
    expect(gatewayFixture.counters.pollCalls).toBe(0);
    expect(gatewayFixture.counters.cancelCalls).toBe(0);
  });
});
