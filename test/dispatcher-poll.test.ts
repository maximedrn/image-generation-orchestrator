import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Option } from "effect";

import type { EngineConfig, PlatformConfig } from "@app/config/config.types.js";
import { ENGINE_JOB_STATUS } from "@app/engine/engine.constants.js";
import { runMigrations } from "@app/database/database.service.js";
import { pollRemoteJob } from "@app/dispatcher/dispatcher-poll.service.js";
import type { DispatcherWorkerDependencies } from "@app/dispatcher/dispatcher.types.js";
import type {
  EngineGatewayShape,
  EnginePoolShape,
} from "@app/engine/engine.interface.js";
import type {
  EngineCapabilities,
  EngineJob,
  EngineReservation,
  EngineSubmission,
  EngineView,
} from "@app/engine/engine.types.js";
import { createJobRepository } from "@app/job/job-repository.factory.js";
import type { JobRepositoryShape } from "@app/job/job-repository.interface.js";
import type { Job, JobCreateRequest, JobResult } from "@app/job/job.types.js";
import type {
  ResultStorageShape,
  StoredResult,
} from "@app/storage/storage.interface.js";
import {
  createJobFixture,
  createPlatformConfigFixture,
  getFirstEngineFixture,
  TEST_ENGINE_ID,
  TEST_REMOTE_JOB_ID,
} from "@test/platform.fixture.js";

/** Upstream calls observed by the polling ownership test. */
interface PollGatewayCounters {
  cancelCalls: number;
  pollCalls: number;
  submitCalls: number;
}

/**
 * Creates a gateway that counts every operation and should remain untouched.
 *
 * @returns ({gateway: EngineGatewayShape; counters: PollGatewayCounters}) Gateway fixture.
 */
const createCountingGateway = (): {
  readonly counters: PollGatewayCounters;
  readonly gateway: EngineGatewayShape;
} => {
  const counters: PollGatewayCounters = {
    cancelCalls: 0,
    pollCalls: 0,
    submitCalls: 0,
  };
  const unexpectedJob: EngineJob = {
    error: null,
    id: "unexpected-remote",
    result: null,
    status: ENGINE_JOB_STATUS.RUNNING,
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

/**
 * Creates no-op scheduler and storage ports unused by an ownership-stop poll.
 *
 * @param engine - (EngineConfig) Engine included in the scheduler reservation.
 * @returns ({pool: EnginePoolShape; storage: ResultStorageShape}) Adapter fixtures.
 */
const createUnusedAdapters = (engine: EngineConfig): {
  readonly pool: EnginePoolShape;
  readonly storage: ResultStorageShape;
} => {
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
 * @param repository - (JobRepositoryShape) In-memory repository.
 * @returns (Promise<Job>) Bound running fixture.
 */
const createBoundJob = async (repository: JobRepositoryShape): Promise<Job> => {
  const queued: Job = createJobFixture("poll-ownership-job");
  await Effect.runPromise(repository.createIfCapacity(queued, 10));
  await Effect.runPromise(
    repository.claim(queued.id, "2026-08-14T12:02:00.000Z", 1),
  );
  const bound: Option.Option<Job> = await Effect.runPromise(
    repository.bindRemote(
      queued.id,
      TEST_ENGINE_ID,
      TEST_REMOTE_JOB_ID,
      "2026-08-14T12:02:00.000Z",
    ),
  );
  if (Option.isNone(bound)) {
    throw new Error("polling fixture could not bind the remote job");
  }
  return bound.value;
};

describe("dispatcher polling ownership", (): void => {
  test("stops before any upstream call when lease renewal loses ownership", async (): Promise<void> => {
    const database: Database = new Database(":memory:", { strict: true });
    runMigrations(database);
    const baseRepository: JobRepositoryShape = createJobRepository(database);
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
    const gatewayFixture: ReturnType<typeof createCountingGateway> =
      createCountingGateway();
    const adapters: ReturnType<typeof createUnusedAdapters> =
      createUnusedAdapters(engine);
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
        { consecutiveFailures: 0, engine, remoteJobId: TEST_REMOTE_JOB_ID },
        dependencies,
      ),
    );
    database.close();
    expect(gatewayFixture.counters.submitCalls).toBe(0);
    expect(gatewayFixture.counters.pollCalls).toBe(0);
    expect(gatewayFixture.counters.cancelCalls).toBe(0);
  });
});
