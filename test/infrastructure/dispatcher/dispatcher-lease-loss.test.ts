import { afterEach, describe, expect, test } from "bun:test";
import type { PlatformConfig } from "@app/core/config/config.types";
import type { DatabaseServiceShape } from "@app/infrastructure/database/database.types";
import { createJobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import type { DispatcherWorkerDependencies } from "@app/infrastructure/dispatcher/dispatcher.types";
import { resumeClaimedJob } from "@app/infrastructure/dispatcher/stages/dispatcher-worker.service";
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
import type { Job, JobResult } from "@app/modules/jobs/job.types";
import {
  createJobFixture,
  createPlatformConfigFixture,
  createTestDatabase,
  getFirstEngineFixture,
  TestIdentifier,
} from "@test/fixtures/platform.fixture";
import { TestInstant } from "@test/fixtures/test.constants";
import { Effect, Option } from "effect";

/** Database owned by the lease-loss regression test. */
let database: DatabaseServiceShape | undefined;

/** Releases the in-memory database after every test. */
afterEach((): void => {
  database?.client.close();
  database = undefined;
});

/** Gateway, scheduler and storage ports used by the lease-loss scenario. */
interface LeaseLossAdapters {
  readonly gateway: EngineGatewayShape;
  readonly pool: EnginePoolShape;
  readonly storage: ResultStorageShape;
}

/**
 * Builds adapters whose only observable upstream side effect is cancellation.
 *
 * @param {PlatformConfig} config - Test platform configuration.
 * @param {{value: number}} cancelCounter - Mutable cancellation counter.
 * @returns {{gateway: EngineGatewayShape; pool: EnginePoolShape; storage: ResultStorageShape}} Adapters.
 */
const createAdapters = (
  config: PlatformConfig,
  cancelCounter: { value: number },
): LeaseLossAdapters => {
  const reservation: EngineReservation = {
    engine: getFirstEngineFixture(config),
  };
  const impossibleJob: EngineJob = {
    error: null,
    id: "unused",
    result: null,
    status: EngineJobStatus.running,
  };
  const gateway: EngineGatewayShape = {
    cancel: (): Effect.Effect<EngineJob> => {
      cancelCounter.value += 1;
      return Effect.succeed(impossibleJob);
    },
    capabilities: (): Effect.Effect<EngineCapabilities> =>
      Effect.succeed({ outputFormats: [], supportsImageGeneration: true }),
    poll: (): Effect.Effect<EngineJob> => Effect.succeed(impossibleJob),
    submit: (): Effect.Effect<EngineSubmission> =>
      Effect.succeed({ id: "unused" }),
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
    writeBase64: (): Effect.Effect<JobResult> =>
      Effect.die("storage must not run"),
  };
  return { gateway, pool, storage };
};

describe("dispatcher recovery lease fencing", (): void => {
  test("does not cancel a durably-bound remote job after lease ownership is lost", async (): Promise<void> => {
    const config: PlatformConfig =
      createPlatformConfigFixture("/tmp/lease-loss");
    database = createTestDatabase();
    const baseRepository: JobRepositoryShape = createJobRepository(
      database.database,
    );
    const queued: Job = createJobFixture("lease-loss-job");
    await Effect.runPromise(baseRepository.createIfCapacity(queued, 10));
    const claimed: Option.Option<Job> = await Effect.runPromise(
      baseRepository.claim(queued.id, TestInstant.farFuture, 1),
    );
    if (Option.isNone(claimed)) {
      throw new Error("lease-loss fixture must be claimed");
    }
    const bound: Option.Option<Job> = await Effect.runPromise(
      baseRepository.bindRemote(
        queued.id,
        TestIdentifier.engine,
        TestIdentifier.remoteJob,
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
    const adapters: LeaseLossAdapters = createAdapters(config, cancelCounter);
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
        TestIdentifier.remoteJob,
        dependencies,
      ),
    );
    expect(cancelCounter.value).toBe(0);
  });
});
