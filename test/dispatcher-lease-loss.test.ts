import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { Effect, Option } from "effect";

import type { PlatformConfig } from "@app/config/config.types.js";
import { runMigrations } from "@app/database/database.service.js";
import { resumeClaimedJob } from "@app/dispatcher/dispatcher-worker.service.js";
import type { DispatcherWorkerDependencies } from "@app/dispatcher/dispatcher.types.js";
import { ENGINE_JOB_STATUS } from "@app/engine/engine.constants.js";
import type { EngineGatewayShape, EnginePoolShape } from "@app/engine/engine.interface.js";
import type {
  EngineCapabilities,
  EngineJob,
  EngineReservation,
  EngineSubmission,
  EngineView,
} from "@app/engine/engine.types.js";
import { createJobRepository } from "@app/job/job-repository.factory.js";
import type { JobRepositoryShape } from "@app/job/job-repository.interface.js";
import type { Job, JobResult } from "@app/job/job.types.js";
import type { ResultStorageShape, StoredResult } from "@app/storage/storage.interface.js";
import {
  createJobFixture,
  createPlatformConfigFixture,
  getFirstEngineFixture,
  TEST_ENGINE_ID,
  TEST_REMOTE_JOB_ID,
} from "@test/platform.fixture.js";

/** Database owned by the lease-loss regression test. */
let database: Database | undefined;

/** Releases the in-memory database after every test. */
afterEach((): void => {
  database?.close();
  database = undefined;
});

/**
 * Builds adapters whose only observable upstream side effect is cancellation.
 *
 * @param config - (PlatformConfig) Test platform configuration.
 * @param cancelCounter - ({value: number}) Mutable cancellation counter.
 * @returns ({gateway: EngineGatewayShape; pool: EnginePoolShape; storage: ResultStorageShape}) Adapters.
 */
const createAdapters = (
  config: PlatformConfig,
  cancelCounter: { value: number },
): {
  readonly gateway: EngineGatewayShape;
  readonly pool: EnginePoolShape;
  readonly storage: ResultStorageShape;
} => {
  const reservation: EngineReservation = { engine: getFirstEngineFixture(config) };
  const impossibleJob: EngineJob = {
    error: null,
    id: "unused",
    result: null,
    status: ENGINE_JOB_STATUS.RUNNING,
  };
  const gateway: EngineGatewayShape = {
    cancel: (): Effect.Effect<EngineJob> => {
      cancelCounter.value += 1;
      return Effect.succeed(impossibleJob);
    },
    capabilities: (): Effect.Effect<EngineCapabilities> =>
      Effect.succeed({ outputFormats: [], supportsImageGeneration: true }),
    poll: (): Effect.Effect<EngineJob> => Effect.succeed(impossibleJob),
    submit: (): Effect.Effect<EngineSubmission> => Effect.succeed({ id: "unused" }),
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
    remove: (): Effect.Effect<void> => Effect.void,
    writeBase64: (): Effect.Effect<JobResult> => Effect.die("storage must not run"),
  };
  return { gateway, pool, storage };
};

describe("dispatcher recovery lease fencing", (): void => {
  test("does not cancel a durably-bound remote job after lease ownership is lost", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture("/tmp/lease-loss");
    database = new Database(":memory:", { strict: true });
    runMigrations(database);
    const baseRepository: JobRepositoryShape = createJobRepository(database);
    const queued: Job = createJobFixture("lease-loss-job");
    await Effect.runPromise(baseRepository.createIfCapacity(queued, 10));
    const claimed: Option.Option<Job> = await Effect.runPromise(
      baseRepository.claim(queued.id, "2099-01-01T00:00:00.000Z", 1),
    );
    if (Option.isNone(claimed)) {
      throw new Error("lease-loss fixture must be claimed");
    }
    const bound: Option.Option<Job> = await Effect.runPromise(
      baseRepository.bindRemote(
        queued.id,
        TEST_ENGINE_ID,
        TEST_REMOTE_JOB_ID,
        "2099-01-01T00:01:00.000Z",
      ),
    );
    if (Option.isNone(bound)) {
      throw new Error("lease-loss fixture must be bound");
    }
    const repository: JobRepositoryShape = {
      ...baseRepository,
      renewLease: (): Effect.Effect<boolean> => Effect.succeed(false),
    };
    const cancelCounter: { value: number } = { value: 0 };
    const adapters: ReturnType<typeof createAdapters> = createAdapters(
      config,
      cancelCounter,
    );
    const dependencies: DispatcherWorkerDependencies = {
      config,
      gateway: adapters.gateway,
      pool: adapters.pool,
      repository,
      storage: adapters.storage,
    };
    await Effect.runPromise(
      resumeClaimedJob(
        bound.value,
        { engine: getFirstEngineFixture(config) },
        TEST_REMOTE_JOB_ID,
        dependencies,
      ),
    );
    expect(cancelCounter.value).toBe(0);
  });
});
