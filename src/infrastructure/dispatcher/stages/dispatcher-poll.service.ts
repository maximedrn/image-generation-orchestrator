import { ErrorTag } from "@app/core/errors/error.constants";
import type { DatabaseError, StorageError } from "@app/core/errors/error.types";
import { DispatcherMessage } from "@app/infrastructure/dispatcher/dispatcher.constants";

import { createLeaseDeadline } from "@app/infrastructure/dispatcher/dispatcher.helpers";
import type {
  DispatcherPollContext,
  DispatcherWorkerDependencies,
} from "@app/infrastructure/dispatcher/dispatcher.types";
import {
  persistCompletedJob,
  persistRemoteCancellation,
  persistRemoteFailure,
  persistStorageFailure,
  retryOrFailJob,
} from "@app/infrastructure/dispatcher/stages/dispatcher-persistence.service";
import { EngineJobStatus } from "@app/infrastructure/engine/engine.constants";
import type { EngineGatewayError } from "@app/infrastructure/engine/engine.interface";
import type {
  EngineJob,
  EngineJobProgress,
} from "@app/infrastructure/engine/engine.types";
import { JobStatus } from "@app/modules/jobs/job.constants";
import type { Job } from "@app/modules/jobs/job.types";
import { Duration, Effect, Either, Option } from "effect";

/** Remote poll result preserved as a typed value for circuit-breaker logic. */
type RemotePollResult = Either.Either<EngineJob, EngineGatewayError>;

/** Optional remote poll result; none means local durable ownership was lost. */
type RemotePollDecision = Option.Option<RemotePollResult>;

/**
 * Calls the appropriate upstream operation after renewing the durable lease.
 *
 * @param {Job} job - Running platform job.
 * @param {DispatcherPollContext} context - Remote polling state.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<RemotePollDecision, DatabaseError>} Remote result or local stop decision.
 */
const fetchRemoteJob = (
  job: Job,
  context: DispatcherPollContext,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<RemotePollDecision, DatabaseError> =>
  Effect.gen(function* fetchRemoteJobEffect() {
    yield* Effect.sleep(
      Duration.millis(dependencies.config.queue.pollIntervalMs),
    );
    const currentOption: Option.Option<Job> =
      yield* dependencies.repository.getById(job.id);
    if (Option.isNone(currentOption)) {
      return Option.none<RemotePollResult>();
    }
    const current: Job = currentOption.value;
    if (current.status !== JobStatus.running) {
      return Option.none<RemotePollResult>();
    }
    const leaseUntil: string = yield* createLeaseDeadline(
      dependencies.config.queue.leaseSeconds,
    );
    const renewed: boolean = yield* dependencies.repository.renewLease(
      job.id,
      leaseUntil,
    );
    if (!renewed) {
      return Option.none<RemotePollResult>();
    }
    const result: RemotePollResult = yield* Effect.either(
      current.cancelRequested
        ? dependencies.gateway.cancel(context.engine, context.remoteJobId)
        : dependencies.gateway.poll(context.engine, context.remoteJobId),
    );
    return Option.some(result);
  });

/**
 * Handles a successful remote response and reports whether polling is terminal.
 *
 * @param {Job} job - Running platform job.
 * @param {EngineJob} remoteJob - Decoded upstream response.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<boolean, DatabaseError | StorageError>} True for terminal states.
 */
const handleRemoteJob = (
  job: Job,
  remoteJob: EngineJob,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<boolean, DatabaseError | StorageError> => {
  switch (remoteJob.status) {
    case EngineJobStatus.cancelled:
      return persistRemoteCancellation(job, dependencies).pipe(Effect.as(true));
    case EngineJobStatus.failed:
      return persistRemoteFailure(job, remoteJob, dependencies).pipe(
        Effect.as(true),
      );
    case EngineJobStatus.succeeded:
      return persistCompletedJob(job, remoteJob, dependencies).pipe(
        Effect.catchTag(
          ErrorTag.storage,
          (_error: StorageError): Effect.Effect<void, DatabaseError> =>
            persistStorageFailure(job, dependencies),
        ),
        Effect.as(true),
      );
    default:
      return Effect.succeed(false);
  }
};

/**
 * Handles one transient upstream polling failure.
 *
 * @param {Job} job - Running platform job.
 * @param {DispatcherPollContext} context - Poll state.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void, DatabaseError | StorageError>} Next poll or retry transition.
 */
const handlePollFailure = (
  job: Job,
  context: DispatcherPollContext,
  dependencies: DispatcherWorkerDependencies,
  error: EngineGatewayError,
): Effect.Effect<void, DatabaseError | StorageError> =>
  Effect.gen(function* handlePollFailureEffect() {
    // The engine answered, and its answer is "later". Penalising it would open
    // the breaker against a healthy engine and stall the whole schedule.
    if (error._tag === ErrorTag.engineBusy) {
      return yield* pollRemoteJob(job, context, dependencies);
    }
    if (error._tag === ErrorTag.engineJobNotFound) {
      yield* Effect.logWarning(DispatcherMessage.remoteJobLost, {
        engineId: context.engine.id,
        jobId: job.id,
        remoteJobId: context.remoteJobId,
      });
      // Requeuing a job the caller cancelled would redo the very work they
      // asked to stop, so an unbound cancellation is honoured as terminal.
      return yield* job.cancelRequested
        ? persistRemoteCancellation(job, dependencies)
        : retryOrFailJob(job, dependencies);
    }
    yield* dependencies.pool.recordFailure(context.engine.id);
    const failures: number = context.consecutiveFailures + 1;
    if (failures >= context.engine.circuitBreaker.failureThreshold) {
      yield* Effect.logWarning(DispatcherMessage.pollingDeferred, {
        engineId: context.engine.id,
        errorMessage: error.message,
        errorTag: error._tag,
        jobId: job.id,
        remoteJobId: context.remoteJobId,
      });
      return;
    }
    yield* pollRemoteJob(
      job,
      { ...context, consecutiveFailures: failures },
      dependencies,
    );
  });

/**
 * Stores freshly reported progress, and only when it actually moved.
 *
 * Polling runs several times per second while sampling advances once every few
 * seconds, so writing unconditionally would turn one useful update into dozens
 * of identical ones.
 *
 * @param {Job} job - Running platform job.
 * @param {EngineJob} remoteJob - Decoded upstream job.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void, DatabaseError>} Durable write, or nothing.
 */
const persistProgress = (
  job: Job,
  remoteJob: EngineJob,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError> =>
  Option.match(Option.fromNullable(remoteJob.progress), {
    onNone: (): Effect.Effect<void, DatabaseError> => Effect.void,
    onSome: (
      progress: EngineJobProgress,
    ): Effect.Effect<void, DatabaseError> =>
      progress.completed === job.progressStep &&
      progress.total === job.progressSteps
        ? Effect.void
        : dependencies.repository.recordProgress(job.id, progress),
  });

/**
 * Handles one successful upstream polling response.
 *
 * @param {Job} job - Running platform job.
 * @param {EngineJob} remoteJob - Decoded upstream job.
 * @param {DispatcherPollContext} context - Poll state.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void, DatabaseError | StorageError>} Terminal persistence or next poll.
 */
const handlePollSuccess = (
  job: Job,
  remoteJob: EngineJob,
  context: DispatcherPollContext,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError | StorageError> =>
  Effect.gen(function* handlePollSuccessEffect() {
    yield* dependencies.pool.recordSuccess(context.engine.id);
    yield* persistProgress(job, remoteJob, dependencies);
    const terminal: boolean = yield* handleRemoteJob(
      job,
      remoteJob,
      dependencies,
    );
    if (!terminal) {
      yield* pollRemoteJob(
        job,
        { ...context, consecutiveFailures: 0 },
        dependencies,
      );
    }
  });

/**
 * Polls one submitted engine job until a terminal state is durable.
 *
 * @param {Job} job - Running platform job.
 * @param {DispatcherPollContext} context - Remote polling state.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void, DatabaseError | StorageError>} Poll lifecycle effect.
 */
const pollRemoteJob = (
  job: Job,
  context: DispatcherPollContext,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError | StorageError> =>
  Effect.suspend(
    (): Effect.Effect<void, DatabaseError | StorageError> =>
      fetchRemoteJob(job, context, dependencies).pipe(
        Effect.flatMap(
          (
            decision: RemotePollDecision,
          ): Effect.Effect<void, DatabaseError | StorageError> =>
            Option.match(decision, {
              onNone: (): Effect.Effect<void> => Effect.void,
              onSome: (
                remoteResult: RemotePollResult,
              ): Effect.Effect<void, DatabaseError | StorageError> =>
                Either.match(remoteResult, {
                  onLeft: (
                    error: EngineGatewayError,
                  ): Effect.Effect<void, DatabaseError | StorageError> =>
                    handlePollFailure(job, context, dependencies, error),
                  onRight: (
                    remoteJob: EngineJob,
                  ): Effect.Effect<void, DatabaseError | StorageError> =>
                    handlePollSuccess(job, remoteJob, context, dependencies),
                }),
            }),
        ),
      ),
  );

export type { RemotePollDecision, RemotePollResult };
export { fetchRemoteJob, handleRemoteJob, pollRemoteJob };
