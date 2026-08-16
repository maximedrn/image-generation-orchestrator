import { type DatabaseError, StorageError } from "@app/core/errors/error.types";

import {
  DispatcherErrorCode,
  DispatcherErrorMessage,
} from "@app/infrastructure/dispatcher/dispatcher.constants";
import type { DispatcherWorkerDependencies } from "@app/infrastructure/dispatcher/dispatcher.types";
import type {
  EngineImageResult,
  EngineImageResultSet,
  EngineJob,
} from "@app/infrastructure/engine/engine.types";
import { JobStatus } from "@app/modules/jobs/job.constants";
import type { Job, JobResult } from "@app/modules/jobs/job.types";
import { Effect, Option, Ref } from "effect";

/**
 * Persists either a retry or a terminal engine failure.
 *
 * @param {Job} job - Currently running durable job.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void, DatabaseError>} Durable transition effect.
 */
const retryOrFailJob = (
  job: Job,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError> => {
  const retry: boolean = job.attempt < dependencies.config.queue.maxAttempts;
  return dependencies.repository
    .transition({
      changes: {
        cancelRequested: false,
        engineId: null,
        errorCode: retry ? null : DispatcherErrorCode.engine,
        errorMessage: retry
          ? null
          : DispatcherErrorMessage.engineRetryExhausted,
        leaseUntil: null,
        remoteJobId: null,
      },
      from: JobStatus.running,
      id: job.id,
      to: retry ? JobStatus.queued : JobStatus.failed,
    })
    .pipe(Effect.asVoid);
};

/**
 * Removes already-written result files without masking the primary failure.
 *
 * @param {readonly JobResult[]} results - Published files to clean up.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void>} Best-effort cleanup effect.
 */
const cleanupStoredResults = (
  results: readonly JobResult[],
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> =>
  Effect.forEach(
    results,
    (result: JobResult): Effect.Effect<void> =>
      dependencies.storage
        .remove(result)
        .pipe(Effect.catchAll((): Effect.Effect<void> => Effect.void)),
    { discard: true },
  );

/**
 * Writes the complete remote result batch and cleans partial files on failure.
 *
 * @param {Job} job - Running platform job.
 * @param {EngineImageResultSet} result - Completed engine result payload.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<readonly JobResult[], StorageError>} Published metadata.
 */
const writeCompletedResults = (
  job: Job,
  result: EngineImageResultSet,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<readonly JobResult[], StorageError> =>
  Effect.gen(function* writeCompletedResultsEffect() {
    const writtenRef: Ref.Ref<readonly JobResult[]> = yield* Ref.make<
      readonly JobResult[]
    >([]);
    const writeBatch: Effect.Effect<readonly JobResult[], StorageError> =
      Effect.forEach(
        result.images,
        (image: EngineImageResult): Effect.Effect<JobResult, StorageError> =>
          dependencies.storage
            .writeBase64(job.id, image.index, result.outputFormat, image.base64)
            .pipe(
              Effect.tap(
                (metadata: JobResult): Effect.Effect<void> =>
                  Ref.update(
                    writtenRef,
                    (current: readonly JobResult[]): readonly JobResult[] => [
                      ...current,
                      metadata,
                    ],
                  ),
              ),
            ),
      );
    return yield* writeBatch.pipe(
      Effect.tapError(
        (): Effect.Effect<void> =>
          Ref.get(writtenRef).pipe(
            Effect.flatMap(
              (written: readonly JobResult[]): Effect.Effect<void> =>
                cleanupStoredResults(written, dependencies),
            ),
          ),
      ),
    );
  });

/**
 * Persists all completed images before committing a successful job state.
 *
 * @param {Job} job - Running platform job.
 * @param {EngineJob} remoteJob - Completed remote job.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void, DatabaseError | StorageError>} Persistence effect.
 */
const persistCompletedJob = (
  job: Job,
  remoteJob: EngineJob,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError | StorageError> => {
  const resultOption: Option.Option<EngineImageResultSet> = Option.fromNullable(
    remoteJob.result,
  ).pipe(
    Option.filter(
      (candidate: EngineImageResultSet): boolean => candidate.images.length > 0,
    ),
  );
  if (Option.isNone(resultOption)) {
    return Effect.fail(
      new StorageError({ message: DispatcherErrorMessage.emptyResult }),
    );
  }
  return Effect.gen(function* persistCompletedJobEffect() {
    const results: readonly JobResult[] = yield* writeCompletedResults(
      job,
      resultOption.value,
      dependencies,
    );
    yield* dependencies.repository
      .saveResults(results)
      .pipe(
        Effect.tapError(
          (): Effect.Effect<void> =>
            cleanupStoredResults(results, dependencies),
        ),
      );
    yield* dependencies.repository
      .transition({
        changes: {
          cancelRequested: false,
          engineId: null,
          errorCode: null,
          errorMessage: null,
          leaseUntil: null,
          remoteJobId: null,
        },
        from: JobStatus.running,
        id: job.id,
        to: JobStatus.succeeded,
      })
      .pipe(Effect.asVoid);
  });
};

/**
 * Persists a remote cancellation as a terminal platform state.
 *
 * @param {Job} job - Running platform job.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void, DatabaseError>} Durable transition effect.
 */
const persistRemoteCancellation = (
  job: Job,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError> =>
  dependencies.repository
    .transition({
      changes: {
        cancelRequested: true,
        engineId: null,
        leaseUntil: null,
        remoteJobId: null,
      },
      from: JobStatus.running,
      id: job.id,
      to: JobStatus.cancelled,
    })
    .pipe(Effect.asVoid);

/**
 * Persists a remote engine failure as a terminal platform state.
 *
 * @param {Job} job - Running platform job.
 * @param {EngineJob} remoteJob - Failed remote job response.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void, DatabaseError>} Durable transition effect.
 */
const persistRemoteFailure = (
  job: Job,
  remoteJob: EngineJob,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError> =>
  dependencies.repository
    .transition({
      changes: {
        cancelRequested: false,
        engineId: null,
        errorCode: remoteJob.error?.code ?? DispatcherErrorCode.remote,
        errorMessage:
          remoteJob.error?.message ?? DispatcherErrorMessage.remoteFailed,
        leaseUntil: null,
        remoteJobId: null,
      },
      from: JobStatus.running,
      id: job.id,
      to: JobStatus.failed,
    })
    .pipe(Effect.asVoid);

/**
 * Marks a job failed when completed binary outputs cannot be persisted.
 *
 * @param {Job} job - Running platform job.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void, DatabaseError>} Durable transition effect.
 */
const persistStorageFailure = (
  job: Job,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError> =>
  dependencies.repository
    .transition({
      changes: {
        engineId: null,
        errorCode: DispatcherErrorCode.storage,
        errorMessage: DispatcherErrorMessage.storageFailed,
        leaseUntil: null,
        remoteJobId: null,
      },
      from: JobStatus.running,
      id: job.id,
      to: JobStatus.failed,
    })
    .pipe(Effect.asVoid);

export {
  cleanupStoredResults,
  persistCompletedJob,
  persistRemoteCancellation,
  persistRemoteFailure,
  persistStorageFailure,
  retryOrFailJob,
  writeCompletedResults,
};
