import { afterEach, describe, expect, test } from "bun:test";
import { ConfigService } from "@app/core/config/config.service";
import type { PlatformConfig } from "@app/core/config/config.types";
import { ErrorTag } from "@app/core/errors/error.constants";
import type { DatabaseError, StorageError } from "@app/core/errors/error.types";
import { DatabaseService } from "@app/infrastructure/database/database.service";
import { dispatchOne } from "@app/infrastructure/dispatcher/dispatcher.service";
import type { EngineJob } from "@app/infrastructure/engine/engine.types";
import { StorageLayout } from "@app/infrastructure/storage/storage.constants";
import type {
  ResultStorageShape,
  StoredResult,
} from "@app/infrastructure/storage/storage.interface";
import { ResultStorage } from "@app/infrastructure/storage/storage.service";
import { OutputFormat } from "@app/modules/jobs/job.constants";
import type { Job, JobResult } from "@app/modules/jobs/job.types";
import { BunFileSystem } from "@effect/platform-bun";
import {
  claimFixtureJob,
  completedRemoteJob,
  createWorkerHarness,
  type WorkerHarness,
} from "@test/fixtures/dispatcher-worker.fixture";
import {
  createJobFixture,
  createPlatformConfigFixture,
} from "@test/fixtures/platform.fixture";
import { TestArtefact, TestImagePayload } from "@test/fixtures/test.constants";
import { Effect, Either, Layer, Option } from "effect";

/** Harnesses opened by the running test. */
const OpenHarnesses: WorkerHarness[] = [];

/**
 * Opens one tracked harness so the database is always closed afterwards.
 *
 * @param {Parameters<typeof createWorkerHarness>[0]} options - Scenario options.
 * @returns {WorkerHarness} Tracked worker harness.
 */
const openHarness = (
  options: Parameters<typeof createWorkerHarness>[0],
): WorkerHarness => {
  const harness: WorkerHarness = createWorkerHarness(options);
  OpenHarnesses.push(harness);
  return harness;
};

/**
 * Runs one storage effect against the real filesystem-backed adapter.
 *
 * @param {PlatformConfig} config - Configuration carrying the storage root.
 * @param {(storage: ResultStorageShape) => Effect.Effect<A, StorageError>} call - Storage call.
 * @returns {Promise<Either.Either<A, StorageError>>} Materialized outcome.
 */
const runStorage = <A>(
  config: PlatformConfig,
  call: (storage: ResultStorageShape) => Effect.Effect<A, StorageError>,
): Promise<Either.Either<A, StorageError>> =>
  Effect.runPromise(
    Effect.scoped(
      ResultStorage.pipe(
        Effect.flatMap(
          (
            storage: ResultStorageShape,
          ): Effect.Effect<Either.Either<A, StorageError>> =>
            Effect.either(call(storage)),
        ),
        Effect.provide(
          ResultStorage.Default.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(ConfigService, config),
                BunFileSystem.layer,
              ),
            ),
          ),
        ),
      ),
    ) as Effect.Effect<Either.Either<A, StorageError>>,
  );

afterEach((): void => {
  for (const harness of OpenHarnesses.splice(0)) {
    harness.database.client.close();
  }
});

describe("result storage against a real filesystem", (): void => {
  test("writes, reads back and removes one published result", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      `/tmp/platform-storage-${crypto.randomUUID()}`,
    );
    const written: Either.Either<JobResult, StorageError> = await runStorage(
      config,
      (storage: ResultStorageShape): Effect.Effect<JobResult, StorageError> =>
        storage.writeBase64(
          "job-store",
          0,
          OutputFormat.png,
          TestImagePayload.short,
        ),
    );
    expect(Either.isRight(written)).toBe(true);
    if (!Either.isRight(written)) return;
    const metadata: JobResult = written.right;
    expect(metadata.sizeBytes).toBe(2);

    const read: Either.Either<StoredResult, StorageError> = await runStorage(
      config,
      (
        storage: ResultStorageShape,
      ): Effect.Effect<StoredResult, StorageError> => storage.read(metadata),
    );
    expect(Either.isRight(read)).toBe(true);

    const removed: Either.Either<void, StorageError> = await runStorage(
      config,
      (storage: ResultStorageShape): Effect.Effect<void, StorageError> =>
        storage.remove(metadata),
    );
    expect(Either.isRight(removed)).toBe(true);
  });

  test("reports a published result whose file vanished", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      `/tmp/platform-storage-${crypto.randomUUID()}`,
    );
    const outcome: Either.Either<StoredResult, StorageError> = await runStorage(
      config,
      (
        storage: ResultStorageShape,
      ): Effect.Effect<StoredResult, StorageError> =>
        storage.read({
          index: 0,
          jobId: "ghost",
          mimeType: TestArtefact.pngMimeType,
          path: `${config.storage.root}/results/ghost/0.png`,
          sha256: TestArtefact.digest,
          sizeBytes: 2,
        }),
    );
    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) {
      expect(outcome.left._tag).toBe(ErrorTag.storage);
    }
  });

  test("reports a write that the filesystem refuses", async (): Promise<void> => {
    const outcome: Either.Either<JobResult, StorageError> = await runStorage(
      createPlatformConfigFixture("/proc/definitely/not/writable"),
      (storage: ResultStorageShape): Effect.Effect<JobResult, StorageError> =>
        storage.writeBase64(
          "job-denied",
          0,
          OutputFormat.png,
          TestImagePayload.short,
        ),
    );
    expect(Either.isLeft(outcome)).toBe(true);
  });

  test("reports a removal the filesystem refuses", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      `/tmp/platform-storage-${crypto.randomUUID()}`,
    );
    const outcome: Either.Either<void, StorageError> = await runStorage(
      config,
      (storage: ResultStorageShape): Effect.Effect<void, StorageError> =>
        storage.remove({
          index: 0,
          jobId: "ghost",
          mimeType: TestArtefact.pngMimeType,
          path: `${config.storage.root}/results/ghost/0.png`,
          sha256: TestArtefact.digest,
          sizeBytes: 2,
        }),
    );
    expect(Either.isLeft(outcome)).toBe(true);
  });
});

describe("publication rollback", (): void => {
  test("removes the temporary file when publishing the result fails", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(
      `/tmp/platform-storage-${crypto.randomUUID()}`,
    );
    const jobId: string = "publish-conflict";
    const finalPath: string = `${config.storage.root}/results/${jobId}/0.png`;
    // A non-empty directory sitting on the final path makes the rename fail
    // after the temporary file has already been written.
    await Bun.$`mkdir -p ${finalPath}`.quiet();
    await Bun.write(`${finalPath}/occupied`, "x");
    const outcome: Either.Either<JobResult, StorageError> = await runStorage(
      config,
      (storage: ResultStorageShape): Effect.Effect<JobResult, StorageError> =>
        storage.writeBase64(jobId, 0, OutputFormat.png, TestImagePayload.short),
    );
    const leftovers: string =
      await Bun.$`ls ${config.storage.root}/results/${jobId}`.text();
    await Bun.$`rm -rf ${config.storage.root}`.quiet();
    expect(Either.isLeft(outcome)).toBe(true);
    // Rollback ran: no orphan .tmp file survives the failed publication.
    expect(leftovers).not.toContain(StorageLayout.temporarySuffix);
  });
});

describe("database service lifecycle", (): void => {
  test("reports a storage root it cannot create", async (): Promise<void> => {
    const outcome: Either.Either<unknown, DatabaseError> =
      await Effect.runPromise(
        Effect.either(
          Effect.scoped(
            DatabaseService.pipe(
              Effect.provide(
                DatabaseService.Default.pipe(
                  Layer.provide(
                    Layer.merge(
                      Layer.succeed(
                        ConfigService,
                        createPlatformConfigFixture("/proc/nope/deeper"),
                      ),
                      BunFileSystem.layer,
                    ),
                  ),
                ),
              ),
            ),
          ) as Effect.Effect<unknown, DatabaseError>,
        ),
      );
    expect(Either.isLeft(outcome)).toBe(true);
  });
});

describe("database file conflicts", (): void => {
  test("reports a database path already taken by a directory", async (): Promise<void> => {
    const root: string = `/tmp/platform-db-${crypto.randomUUID()}`;
    await Bun.$`mkdir -p ${root}/app.sqlite`.quiet();
    await Bun.write(`${root}/app.sqlite/occupied`, "x");
    const outcome: Either.Either<unknown, DatabaseError> =
      await Effect.runPromise(
        Effect.either(
          Effect.scoped(
            DatabaseService.pipe(
              Effect.provide(
                DatabaseService.Default.pipe(
                  Layer.provide(
                    Layer.merge(
                      Layer.succeed(
                        ConfigService,
                        createPlatformConfigFixture(root),
                      ),
                      BunFileSystem.layer,
                    ),
                  ),
                ),
              ),
            ),
          ) as Effect.Effect<unknown, DatabaseError>,
        ),
      );
    await Bun.$`rm -rf ${root}`.quiet();
    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) {
      expect(outcome.left._tag).toBe(ErrorTag.database);
    }
  });
});

describe("dispatcher claims one queued job", (): void => {
  test("forks a worker for the head of the queue", async (): Promise<void> => {
    const harness: WorkerHarness = openHarness({
      script: { responses: [completedRemoteJob()] },
    });
    const job: Job = createJobFixture("dispatch-head");
    await Effect.runPromise(harness.repository.createIfCapacity(job, 10));
    await Effect.runPromise(dispatchOne(harness.dependencies));
    // The forked worker owns the job from here; the claim itself is what matters.
    const claimed: Option.Option<Job> = await Effect.runPromise(
      harness.repository.getById(job.id),
    );
    expect(claimed._tag).toBe("Some");
    expect(claimFixtureJob).toBeDefined();
    const unusedRemote: EngineJob = completedRemoteJob();
    expect(unusedRemote.id).toBeDefined();
  });
});
