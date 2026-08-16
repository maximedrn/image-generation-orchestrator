import { describe, expect, test } from "bun:test";
import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { EngineUnavailableError } from "@app/core/errors/error.types";
import type { DatabaseServiceShape } from "@app/infrastructure/database/database.types";
import { createJobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import { DispatcherRecoveryScope } from "@app/infrastructure/dispatcher/dispatcher.constants";
import type { DispatcherWorkerDependencies } from "@app/infrastructure/dispatcher/dispatcher.types";
import {
  recoverRemoteJob,
  shouldRecoverJob,
} from "@app/infrastructure/dispatcher/stages/dispatcher-recovery.service";
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
import {
  JobStatus,
  OutputFormat,
  OutputMimeType,
} from "@app/modules/jobs/job.constants";
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
import { TestImagePayload, TestInstant } from "@test/fixtures/test.constants";
import { Duration, Effect, Option } from "effect";

/** Mutable gateway counters used only by the recovery contract test. */
interface GatewayCounters {
  pollCalls: number;
  submitCalls: number;
}

/** Repository state shared by every recovery scenario. */
interface RunningJobFixture {
  readonly database: DatabaseServiceShape;
  readonly job: Job;
  readonly repository: JobRepositoryShape;
}

/**
 * Creates an in-memory repository containing one bound running job.
 *
 * @returns {Promise<RunningJobFixture>} Recovery fixture.
 */
const createRunningJobFixture = async (): Promise<RunningJobFixture> => {
  const database: DatabaseServiceShape = createTestDatabase();
  const repository: JobRepositoryShape = createJobRepository(database.database);
  const queuedJob: Job = createJobFixture("restart-job");
  await Effect.runPromise(repository.createIfCapacity(queuedJob, 10));
  await Effect.runPromise(
    repository.claim(queuedJob.id, "2026-08-14T00:00:00.000Z", 1),
  );
  const boundOption: Option.Option<Job> = await Effect.runPromise(
    repository.bindRemote(
      queuedJob.id,
      TestIdentifier.engine,
      TestIdentifier.remoteJob,
      "2026-08-14T00:00:01.000Z",
    ),
  );
  if (Option.isNone(boundOption)) {
    database.client.close();
    throw new Error("running recovery fixture could not be bound");
  }
  return { database, job: boundOption.value, repository };
};

/** Counting gateway stub returned by the recovery gateway factory. */
interface RecoveryGatewayFixture {
  readonly counters: GatewayCounters;
  readonly gateway: EngineGatewayShape;
}

/**
 * Creates a deterministic successful gateway and call counters.
 *
 * @returns {{gateway: EngineGatewayShape; counters: GatewayCounters}} Gateway fixture.
 */
const createRecoveryGateway = (): RecoveryGatewayFixture => {
  const counters: GatewayCounters = { pollCalls: 0, submitCalls: 0 };
  const completedJob: EngineJob = {
    error: null,
    id: TestIdentifier.remoteJob,
    result: {
      images: [{ base64: TestImagePayload.hello, index: 0 }],
      outputFormat: OutputFormat.png,
    },
    status: EngineJobStatus.succeeded,
  };
  const gateway: EngineGatewayShape = {
    cancel: (): Effect.Effect<EngineJob> => Effect.succeed(completedJob),
    capabilities: (): Effect.Effect<EngineCapabilities> =>
      Effect.succeed({
        outputFormats: [OutputFormat.png],
        supportsImageGeneration: true,
      }),
    poll: (): Effect.Effect<EngineJob> => {
      counters.pollCalls += 1;
      return Effect.succeed(completedJob);
    },
    submit: (
      _engine: EngineConfig,
      _request: JobCreateRequest,
    ): Effect.Effect<EngineSubmission> => {
      counters.submitCalls += 1;
      return Effect.succeed({ id: "unexpected-submission" });
    },
  };
  return { counters, gateway };
};

/** Scheduler and storage ports used by the recovery scenarios. */
interface RecoveryAdapters {
  readonly pool: EnginePoolShape;
  readonly storage: ResultStorageShape;
}

/**
 * Creates minimal scheduler and storage ports for recovery testing.
 *
 * @param {PlatformConfig} config - Test platform configuration.
 * @returns {RecoveryAdapters} Adapter fixtures.
 */
const createRecoveryAdapters = (config: PlatformConfig): RecoveryAdapters => {
  const reservation: EngineReservation = {
    engine: getFirstEngineFixture(config),
  };
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
    remove: (_metadata: JobResult): Effect.Effect<void> => Effect.void,
    writeBase64: (jobId: string, index: number): Effect.Effect<JobResult> =>
      Effect.succeed({
        index,
        jobId,
        mimeType: OutputMimeType[OutputFormat.png],
        path: `/tmp/${jobId}/${index}.png`,
        sha256: "test-sha256",
        sizeBytes: 5,
      }),
  };
  return { pool, storage };
};

/** Value reused across this suite. */
const RecoveryStorageRoot: string = "/tmp/recovery-storage";

describe("dispatcher restart recovery", (): void => {
  test("recognizes expired leases without touching active leases", (): void => {
    const expired: Job = {
      ...createJobFixture("expired"),
      leaseUntil: "2026-08-14T10:00:00.000Z",
    };
    const active: Job = {
      ...createJobFixture("active"),
      leaseUntil: TestInstant.created,
    };
    expect(
      shouldRecoverJob(
        expired,
        "2026-08-14T11:00:00.000Z",
        DispatcherRecoveryScope.expiredOnly,
      ),
    ).toBe(true);
    expect(
      shouldRecoverJob(
        active,
        "2026-08-14T11:00:00.000Z",
        DispatcherRecoveryScope.expiredOnly,
      ),
    ).toBe(false);
  });

  test("resumes the existing remote id instead of submitting duplicate work", async (): Promise<void> => {
    const fixture: RunningJobFixture = await createRunningJobFixture();
    const config: PlatformConfig = {
      ...createPlatformConfigFixture(RecoveryStorageRoot),
      queue: {
        ...createPlatformConfigFixture(RecoveryStorageRoot).queue,
        pollIntervalMs: 1,
      },
    };
    const gatewayFixture: RecoveryGatewayFixture = createRecoveryGateway();
    const adapters: RecoveryAdapters = createRecoveryAdapters(config);
    const dependencies: DispatcherWorkerDependencies = {
      config,
      gateway: gatewayFixture.gateway,
      pool: adapters.pool,
      repository: fixture.repository,
      storage: adapters.storage,
    };
    await Effect.runPromise(
      recoverRemoteJob(fixture.job, dependencies).pipe(
        Effect.zipRight(Effect.sleep(Duration.millis(25))),
      ),
    );
    const recoveredOption: Option.Option<Job> = await Effect.runPromise(
      fixture.repository.getById(fixture.job.id),
    );
    fixture.database.client.close();
    expect(gatewayFixture.counters.submitCalls).toBe(0);
    expect(gatewayFixture.counters.pollCalls).toBeGreaterThan(0);
    expect(Option.isSome(recoveredOption)).toBe(true);
    if (Option.isSome(recoveredOption)) {
      expect(recoveredOption.value.status).toBe(JobStatus.succeeded);
    }
  });

  test("keeps the remote id durable when polling reaches the circuit threshold", async (): Promise<void> => {
    const fixture: RunningJobFixture = await createRunningJobFixture();
    const baseConfig: PlatformConfig =
      createPlatformConfigFixture(RecoveryStorageRoot);
    const baseEngine: EngineConfig = getFirstEngineFixture(baseConfig);
    const config: PlatformConfig = {
      ...baseConfig,
      engines: [
        {
          ...baseEngine,
          circuitBreaker: { ...baseEngine.circuitBreaker, failureThreshold: 1 },
        },
      ],
      queue: { ...baseConfig.queue, pollIntervalMs: 1 },
    };
    const gatewayFixture: RecoveryGatewayFixture = createRecoveryGateway();
    const failingGateway: EngineGatewayShape = {
      ...gatewayFixture.gateway,
      poll: (
        engine: EngineConfig,
      ): Effect.Effect<EngineJob, EngineUnavailableError> => {
        gatewayFixture.counters.pollCalls += 1;
        return Effect.fail(
          new EngineUnavailableError({
            engineId: engine.id,
            message: "test polling outage",
          }),
        );
      },
    };
    const adapters: RecoveryAdapters = createRecoveryAdapters(config);
    const dependencies: DispatcherWorkerDependencies = {
      config,
      gateway: failingGateway,
      pool: adapters.pool,
      repository: fixture.repository,
      storage: adapters.storage,
    };
    await Effect.runPromise(
      recoverRemoteJob(fixture.job, dependencies).pipe(
        Effect.zipRight(Effect.sleep(Duration.millis(25))),
      ),
    );
    const recoveredOption: Option.Option<Job> = await Effect.runPromise(
      fixture.repository.getById(fixture.job.id),
    );
    fixture.database.client.close();
    expect(gatewayFixture.counters.submitCalls).toBe(0);
    expect(gatewayFixture.counters.pollCalls).toBeGreaterThan(0);
    expect(Option.isSome(recoveredOption)).toBe(true);
    if (Option.isSome(recoveredOption)) {
      expect(recoveredOption.value.status).toBe(JobStatus.running);
      expect(recoveredOption.value.remoteJobId).toBe(TestIdentifier.remoteJob);
    }
  });
});
