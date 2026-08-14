import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Duration, Effect, Option } from "effect";

import type { EngineConfig, PlatformConfig } from "@app/config/config.types.js";
import { runMigrations } from "@app/database/database.service.js";
import { recoverRemoteJob, shouldRecoverJob } from "@app/dispatcher/dispatcher-recovery.service.js";
import type { DispatcherWorkerDependencies } from "@app/dispatcher/dispatcher.types.js";
import type {
  EngineGatewayShape,
  EnginePoolShape,
} from "@app/engine/engine.interface.js";
import { ENGINE_JOB_STATUS } from "@app/engine/engine.constants.js";
import type {
  EngineCapabilities,
  EngineJob,
  EngineReservation,
  EngineSubmission,
  EngineView,
} from "@app/engine/engine.types.js";
import { JOB_STATUS, OUTPUT_FORMAT, OUTPUT_MIME_TYPE } from "@app/job/job.constants.js";
import { createJobRepository } from "@app/job/job-repository.factory.js";
import type { JobRepositoryShape } from "@app/job/job-repository.interface.js";
import type { Job, JobCreateRequest, JobResult } from "@app/job/job.types.js";
import { EngineUnavailableError } from "@app/error/error.types.js";
import type { ResultStorageShape, StoredResult } from "@app/storage/storage.interface.js";
import {
  createJobFixture,
  createPlatformConfigFixture,
  getFirstEngineFixture,
  TEST_ENGINE_ID,
  TEST_REMOTE_JOB_ID,
} from "@test/platform.fixture.js";

/** Mutable gateway counters used only by the recovery contract test. */
interface GatewayCounters {
  pollCalls: number;
  submitCalls: number;
}

/**
 * Creates an in-memory repository containing one bound running job.
 *
 * @returns (Promise<{database: Database; job: Job; repository: JobRepositoryShape}>) Recovery fixture.
 */
const createRunningJobFixture = async (): Promise<{
  readonly database: Database;
  readonly job: Job;
  readonly repository: JobRepositoryShape;
}> => {
  const database: Database = new Database(":memory:", { strict: true });
  runMigrations(database);
  const repository: JobRepositoryShape = createJobRepository(database);
  const queuedJob: Job = createJobFixture("restart-job");
  await Effect.runPromise(repository.createIfCapacity(queuedJob, 10));
  await Effect.runPromise(
    repository.claim(queuedJob.id, "2026-08-14T00:00:00.000Z", 1),
  );
  const boundOption: Option.Option<Job> = await Effect.runPromise(
    repository.bindRemote(
      queuedJob.id,
      TEST_ENGINE_ID,
      TEST_REMOTE_JOB_ID,
      "2026-08-14T00:00:01.000Z",
    ),
  );
  if (Option.isNone(boundOption)) {
    database.close();
    throw new Error("running recovery fixture could not be bound");
  }
  return { database, job: boundOption.value, repository };
};

/**
 * Creates a deterministic successful gateway and call counters.
 *
 * @returns ({gateway: EngineGatewayShape; counters: GatewayCounters}) Gateway fixture.
 */
const createRecoveryGateway = (): {
  readonly counters: GatewayCounters;
  readonly gateway: EngineGatewayShape;
} => {
  const counters: GatewayCounters = { pollCalls: 0, submitCalls: 0 };
  const completedJob: EngineJob = {
    error: null,
    id: TEST_REMOTE_JOB_ID,
    result: {
      images: [{ base64: "aGVsbG8=", index: 0 }],
      outputFormat: OUTPUT_FORMAT.PNG,
    },
    status: ENGINE_JOB_STATUS.SUCCEEDED,
  };
  const gateway: EngineGatewayShape = {
    cancel: (): Effect.Effect<EngineJob> => Effect.succeed(completedJob),
    capabilities: (): Effect.Effect<EngineCapabilities> =>
      Effect.succeed({ outputFormats: [OUTPUT_FORMAT.PNG], supportsImageGeneration: true }),
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

/**
 * Creates minimal scheduler and storage ports for recovery testing.
 *
 * @param config - (PlatformConfig) Test platform configuration.
 * @returns ({pool: EnginePoolShape; storage: ResultStorageShape}) Adapter fixtures.
 */
const createRecoveryAdapters = (config: PlatformConfig): {
  readonly pool: EnginePoolShape;
  readonly storage: ResultStorageShape;
} => {
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
      Effect.succeed({ stream: new ReadableStream<Uint8Array>(), metadata }),
    remove: (_metadata: JobResult): Effect.Effect<void> => Effect.void,
    writeBase64: (
      jobId: string,
      index: number,
    ): Effect.Effect<JobResult> =>
      Effect.succeed({
        index,
        jobId,
        mimeType: OUTPUT_MIME_TYPE[OUTPUT_FORMAT.PNG],
        path: `/tmp/${jobId}/${index}.png`,
        sha256: "test-sha256",
        sizeBytes: 5,
      }),
  };
  return { pool, storage };
};

describe("dispatcher restart recovery", (): void => {
  test("recognizes expired leases without touching active leases", (): void => {
    const expired: Job = {
      ...createJobFixture("expired"),
      leaseUntil: "2026-08-14T10:00:00.000Z",
    };
    const active: Job = {
      ...createJobFixture("active"),
      leaseUntil: "2026-08-14T12:00:00.000Z",
    };
    expect(
      shouldRecoverJob(expired, "2026-08-14T11:00:00.000Z", "expired-only"),
    ).toBe(true);
    expect(
      shouldRecoverJob(active, "2026-08-14T11:00:00.000Z", "expired-only"),
    ).toBe(false);
  });

  test("resumes the existing remote id instead of submitting duplicate work", async (): Promise<void> => {
    const fixture: Awaited<ReturnType<typeof createRunningJobFixture>> =
      await createRunningJobFixture();
    const config: PlatformConfig = {
      ...createPlatformConfigFixture("/tmp/recovery-storage"),
      queue: {
        ...createPlatformConfigFixture("/tmp/recovery-storage").queue,
        pollIntervalMs: 1,
      },
    };
    const gatewayFixture: ReturnType<typeof createRecoveryGateway> =
      createRecoveryGateway();
    const adapters: ReturnType<typeof createRecoveryAdapters> =
      createRecoveryAdapters(config);
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
    fixture.database.close();
    expect(gatewayFixture.counters.submitCalls).toBe(0);
    expect(gatewayFixture.counters.pollCalls).toBeGreaterThan(0);
    expect(Option.isSome(recoveredOption)).toBe(true);
    if (Option.isSome(recoveredOption)) {
      expect(recoveredOption.value.status).toBe(JOB_STATUS.SUCCEEDED);
    }
  });

  test("keeps the remote id durable when polling reaches the circuit threshold", async (): Promise<void> => {
    const fixture: Awaited<ReturnType<typeof createRunningJobFixture>> =
      await createRunningJobFixture();
    const baseConfig: PlatformConfig =
      createPlatformConfigFixture("/tmp/recovery-storage");
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
    const gatewayFixture: ReturnType<typeof createRecoveryGateway> =
      createRecoveryGateway();
    const failingGateway: EngineGatewayShape = {
      ...gatewayFixture.gateway,
      poll: (engine: EngineConfig): Effect.Effect<EngineJob, EngineUnavailableError> => {
        gatewayFixture.counters.pollCalls += 1;
        return Effect.fail(
          new EngineUnavailableError({
            engineId: engine.id,
            message: "test polling outage",
          }),
        );
      },
    };
    const adapters: ReturnType<typeof createRecoveryAdapters> =
      createRecoveryAdapters(config);
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
    fixture.database.close();
    expect(gatewayFixture.counters.submitCalls).toBe(0);
    expect(gatewayFixture.counters.pollCalls).toBeGreaterThan(0);
    expect(Option.isSome(recoveredOption)).toBe(true);
    if (Option.isSome(recoveredOption)) {
      expect(recoveredOption.value.status).toBe(JOB_STATUS.RUNNING);
      expect(recoveredOption.value.remoteJobId).toBe(TEST_REMOTE_JOB_ID);
    }
  });
});
