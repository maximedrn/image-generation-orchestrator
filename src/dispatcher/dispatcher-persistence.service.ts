import { Effect, Ref } from "effect";

import {
  DISPATCHER_ERROR_CODE,
  DISPATCHER_ERROR_MESSAGE,
} from "@app/dispatcher/dispatcher.constants.js";
import type { DispatcherWorkerDependencies } from "@app/dispatcher/dispatcher.types.js";
import type {
  EngineImageResult,
  EngineImageResultSet,
  EngineJob,
} from "@app/engine/engine.types.js";
import { StorageError, type DatabaseError } from "@app/error/error.types.js";
import { JOB_STATUS } from "@app/job/job.constants.js";
import type { Job, JobResult } from "@app/job/job.types.js";

/**
 * Persists either a retry or a terminal engine failure.
 *
 * @param job - (Job) Currently running durable job.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void, DatabaseError>) Durable transition effect.
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
        errorCode: retry ? null : DISPATCHER_ERROR_CODE.ENGINE,
        errorMessage: retry
          ? null
          : DISPATCHER_ERROR_MESSAGE.ENGINE_RETRY_EXHAUSTED,
        leaseUntil: null,
        remoteJobId: null,
      },
      from: JOB_STATUS.RUNNING,
      id: job.id,
      to: retry ? JOB_STATUS.QUEUED : JOB_STATUS.FAILED,
    })
    .pipe(Effect.asVoid);
};

/**
 * Removes already-written result files without masking the primary failure.
 *
 * @param results - (readonly JobResult[]) Published files to clean up.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void>) Best-effort cleanup effect.
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
 * @param job - (Job) Running platform job.
 * @param result - (EngineImageResultSet) Completed engine result payload.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<readonly JobResult[], StorageError>) Published metadata.
 */
const writeCompletedResults = (
  job: Job,
  result: EngineImageResultSet,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<readonly JobResult[], StorageError> =>
  Effect.gen(function* writeCompletedResultsEffect(): Generator<unknown, readonly JobResult[]> {
    const writtenRef: Ref.Ref<readonly JobResult[]> = yield* Ref.make<readonly JobResult[]>([]);
    const writeBatch: Effect.Effect<readonly JobResult[], StorageError> = Effect.forEach(
      result.images,
      (image: EngineImageResult): Effect.Effect<JobResult, StorageError> =>
        dependencies.storage
          .writeBase64(job.id, image.index, result.outputFormat, image.base64)
          .pipe(
            Effect.tap((metadata: JobResult): Effect.Effect<void> =>
              Ref.update(writtenRef, (current: readonly JobResult[]): readonly JobResult[] => [
                ...current,
                metadata,
              ]),
            ),
          ),
    );
    return yield* writeBatch.pipe(
      Effect.tapError((): Effect.Effect<void> =>
        Ref.get(writtenRef).pipe(
          Effect.flatMap((written: readonly JobResult[]): Effect.Effect<void> =>
            cleanupStoredResults(written, dependencies),
          ),
        ),
      ),
    );
  });

/**
 * Persists all completed images before committing a successful job state.
 *
 * @param job - (Job) Running platform job.
 * @param remoteJob - (EngineJob) Completed remote job.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void, DatabaseError | StorageError>) Persistence effect.
 */
const persistCompletedJob = (
  job: Job,
  remoteJob: EngineJob,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError | StorageError> => {
  const result: EngineImageResultSet | null = remoteJob.result;
  if (result === null || result.images.length === 0) {
    return Effect.fail(
      new StorageError({ message: DISPATCHER_ERROR_MESSAGE.EMPTY_RESULT }),
    );
  }
  return Effect.gen(function* persistCompletedJobEffect(): Generator<unknown, void> {
    const results: readonly JobResult[] = yield* writeCompletedResults(
      job,
      result,
      dependencies,
    );
    yield* dependencies.repository.saveResults(results).pipe(
      Effect.tapError((): Effect.Effect<void> =>
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
        from: JOB_STATUS.RUNNING,
        id: job.id,
        to: JOB_STATUS.SUCCEEDED,
      })
      .pipe(Effect.asVoid);
  });
};

/**
 * Persists a remote cancellation as a terminal platform state.
 *
 * @param job - (Job) Running platform job.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void, DatabaseError>) Durable transition effect.
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
      from: JOB_STATUS.RUNNING,
      id: job.id,
      to: JOB_STATUS.CANCELLED,
    })
    .pipe(Effect.asVoid);

/**
 * Persists a remote engine failure as a terminal platform state.
 *
 * @param job - (Job) Running platform job.
 * @param remoteJob - (EngineJob) Failed remote job response.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void, DatabaseError>) Durable transition effect.
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
        errorCode: remoteJob.error?.code ?? DISPATCHER_ERROR_CODE.REMOTE,
        errorMessage: remoteJob.error?.message ?? DISPATCHER_ERROR_MESSAGE.REMOTE_FAILED,
        leaseUntil: null,
        remoteJobId: null,
      },
      from: JOB_STATUS.RUNNING,
      id: job.id,
      to: JOB_STATUS.FAILED,
    })
    .pipe(Effect.asVoid);

/**
 * Marks a job failed when completed binary outputs cannot be persisted.
 *
 * @param job - (Job) Running platform job.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void, DatabaseError>) Durable transition effect.
 */
const persistStorageFailure = (
  job: Job,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError> =>
  dependencies.repository
    .transition({
      changes: {
        engineId: null,
        errorCode: DISPATCHER_ERROR_CODE.STORAGE,
        errorMessage: DISPATCHER_ERROR_MESSAGE.STORAGE_FAILED,
        leaseUntil: null,
        remoteJobId: null,
      },
      from: JOB_STATUS.RUNNING,
      id: job.id,
      to: JOB_STATUS.FAILED,
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
