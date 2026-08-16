import type { DatabaseError, StorageError } from "@app/core/errors/error.types";
import { DispatcherMessage } from "@app/infrastructure/dispatcher/dispatcher.constants";

import { createLeaseDeadline } from "@app/infrastructure/dispatcher/dispatcher.helpers";
import type { DispatcherWorkerDependencies } from "@app/infrastructure/dispatcher/dispatcher.types";
import { retryOrFailJob } from "@app/infrastructure/dispatcher/stages/dispatcher-persistence.service";
import { pollRemoteJob } from "@app/infrastructure/dispatcher/stages/dispatcher-poll.service";
import type { EngineGatewayError } from "@app/infrastructure/engine/engine.interface";
import type {
  EngineReservation,
  EngineSubmission,
} from "@app/infrastructure/engine/engine.types";
import type { Job } from "@app/modules/jobs/job.types";
import { Duration, Effect, Either, Option, Schedule } from "effect";

/** Error union that can occur after a remote identifier is durable. */
type PostSubmissionError = DatabaseError | StorageError;

/**
 * Records one pre-submission engine failure and applies bounded job retry policy.
 *
 * @param {Job} job - Claimed job that has not received a remote identifier.
 * @param {EngineReservation} reservation - Held engine reservation.
 * @param {EngineGatewayError} error - Submission failure.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void>} Contained retry/logging effect.
 */
const handleSubmissionFailure = (
  job: Job,
  reservation: EngineReservation,
  error: EngineGatewayError,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> =>
  dependencies.pool.recordFailure(reservation.engine.id).pipe(
    Effect.zipRight(
      retryOrFailJob(job, dependencies).pipe(
        Effect.catchAll(
          (databaseError: DatabaseError): Effect.Effect<void> =>
            Effect.logError(DispatcherMessage.retryPersistenceFailed, {
              errorTag: databaseError._tag,
              jobId: job.id,
            }),
        ),
      ),
    ),
    Effect.zipRight(
      Effect.logError(DispatcherMessage.submissionFailed, {
        engineId: reservation.engine.id,
        errorMessage: error.message,
        errorTag: error._tag,
        jobId: job.id,
      }),
    ),
  );

/**
 * Logs a post-submission failure without clearing the durable remote identifier.
 *
 * Lease recovery will resume the same remote work instead of resubmitting it.
 *
 * @param {Job} job - Remote-bound durable job.
 * @param {string} remoteJobId - Durable remote inference identifier.
 * @param {PostSubmissionError} error - Local persistence/storage failure.
 * @returns {Effect.Effect<void>} Contained logging effect.
 */
const handlePostSubmissionFailure = (
  job: Job,
  remoteJobId: string,
  error: PostSubmissionError,
): Effect.Effect<void> =>
  Effect.logError(DispatcherMessage.postSubmissionDeferred, {
    errorTag: error._tag,
    jobId: job.id,
    remoteJobId,
  });

/**
 * Repeatedly binds a submitted remote job until durable storage is available.
 *
 * @param {Job} job - Claimed platform job.
 * @param {EngineReservation} reservation - Held engine reservation.
 * @param {EngineSubmission} submission - Accepted remote job.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<Option.Option<Job>, DatabaseError>} Bound durable job.
 */
const bindSubmittedJob = (
  job: Job,
  reservation: EngineReservation,
  submission: EngineSubmission,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<Option.Option<Job>, DatabaseError> => {
  const bindAttempt: Effect.Effect<
    Option.Option<Job>,
    DatabaseError
  > = Effect.gen(function* bindSubmittedJobEffect() {
    const leaseUntil: string = yield* createLeaseDeadline(
      dependencies.config.queue.leaseSeconds,
    );
    return yield* dependencies.repository.bindRemote(
      job.id,
      reservation.engine.id,
      submission.id,
      leaseUntil,
    );
  });
  // Bounded by the lease: past that point the lease has expired and recovery
  // owns the job, so retrying here would only pin the engine reservation.
  return Effect.retry(
    bindAttempt,
    Schedule.spaced(
      Duration.seconds(dependencies.config.queue.recoveryIntervalSeconds),
    ).pipe(
      Schedule.upTo(Duration.seconds(dependencies.config.queue.leaseSeconds)),
    ),
  );
};

/**
 * Cancels remote work that cannot be associated with a running durable job.
 *
 * @param {EngineReservation} reservation - Held engine reservation.
 * @param {string} remoteJobId - Remote inference identifier.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void>} Best-effort remote cancellation.
 */
const cancelUnboundRemoteJob = (
  reservation: EngineReservation,
  remoteJobId: string,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> =>
  dependencies.gateway.cancel(reservation.engine, remoteJobId).pipe(
    Effect.tap(
      (): Effect.Effect<void> =>
        dependencies.pool.recordSuccess(reservation.engine.id),
    ),
    Effect.catchAll(
      (error: EngineGatewayError): Effect.Effect<void> =>
        dependencies.pool.recordFailure(reservation.engine.id).pipe(
          Effect.zipRight(
            Effect.logWarning(DispatcherMessage.unboundCancellationFailed, {
              engineId: reservation.engine.id,
              errorTag: error._tag,
              remoteJobId,
            }),
          ),
        ),
    ),
    Effect.asVoid,
  );

/**
 * Durably associates a submitted remote job or cancels it when binding is impossible.
 *
 * @param {Job} job - Claimed platform job.
 * @param {EngineReservation} reservation - Held engine reservation.
 * @param {EngineSubmission} submission - Accepted remote job.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<Option.Option<Job>>} Durable bound job when still claimable.
 */
const bindOrCancelSubmittedJob = (
  job: Job,
  reservation: EngineReservation,
  submission: EngineSubmission,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<Option.Option<Job>> =>
  Effect.either(
    bindSubmittedJob(job, reservation, submission, dependencies).pipe(
      Effect.onInterrupt(
        (): Effect.Effect<void> =>
          cancelUnboundRemoteJob(reservation, submission.id, dependencies),
      ),
    ),
  ).pipe(
    Effect.flatMap(
      (
        result: Either.Either<Option.Option<Job>, DatabaseError>,
      ): Effect.Effect<Option.Option<Job>> => {
        if (Either.isLeft(result)) {
          return handlePostSubmissionFailure(
            job,
            submission.id,
            result.left,
          ).pipe(
            Effect.zipRight(
              cancelUnboundRemoteJob(reservation, submission.id, dependencies),
            ),
            Effect.as(Option.none<Job>()),
          );
        }
        if (Option.isNone(result.right)) {
          return cancelUnboundRemoteJob(
            reservation,
            submission.id,
            dependencies,
          ).pipe(Effect.as(Option.none<Job>()));
        }
        return Effect.succeed(result.right);
      },
    ),
  );

/**
 * Polls one durably bound remote submission and defers local failures to recovery.
 *
 * @param {Job} job - Durable remote-bound job.
 * @param {EngineReservation} reservation - Held engine reservation.
 * @param {EngineSubmission} submission - Accepted remote job.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void>} Contained remote polling lifecycle.
 */
const pollBoundSubmission = (
  job: Job,
  reservation: EngineReservation,
  submission: EngineSubmission,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> =>
  pollRemoteJob(
    job,
    {
      consecutiveFailures: 0,
      engine: reservation.engine,
      remoteJobId: submission.id,
    },
    dependencies,
  ).pipe(
    Effect.catchAll(
      (error: PostSubmissionError): Effect.Effect<void> =>
        handlePostSubmissionFailure(job, submission.id, error),
    ),
  );

export type { PostSubmissionError };
export {
  bindOrCancelSubmittedJob,
  bindSubmittedJob,
  cancelUnboundRemoteJob,
  handlePostSubmissionFailure,
  handleSubmissionFailure,
  pollBoundSubmission,
};
