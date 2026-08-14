import { Duration, Effect, Either, Option, Schedule } from "effect";

import { createLeaseDeadline } from "@app/dispatcher/dispatcher.helpers.js";
import { retryOrFailJob } from "@app/dispatcher/dispatcher-persistence.service.js";
import { pollRemoteJob } from "@app/dispatcher/dispatcher-poll.service.js";
import type { DispatcherWorkerDependencies } from "@app/dispatcher/dispatcher.types.js";
import type { EngineGatewayError } from "@app/engine/engine.interface.js";
import type {
  EngineReservation,
  EngineSubmission,
} from "@app/engine/engine.types.js";
import type { DatabaseError, StorageError } from "@app/error/error.types.js";
import type { Job } from "@app/job/job.types.js";

/** Error union that can occur after a remote identifier is durable. */
type PostSubmissionError = DatabaseError | StorageError;

/**
 * Records one pre-submission engine failure and applies bounded job retry policy.
 *
 * @param job - (Job) Claimed job that has not received a remote identifier.
 * @param reservation - (EngineReservation) Held engine reservation.
 * @param error - (EngineGatewayError) Submission failure.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void>) Contained retry/logging effect.
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
        Effect.catchAll((databaseError: DatabaseError): Effect.Effect<void> =>
          Effect.logError("dispatcher retry persistence failed", {
            errorTag: databaseError._tag,
            jobId: job.id,
          }),
        ),
      ),
    ),
    Effect.zipRight(
      Effect.logError("engine submission failed", {
        engineId: reservation.engine.id,
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
 * @param job - (Job) Remote-bound durable job.
 * @param remoteJobId - (string) Durable remote inference identifier.
 * @param error - (PostSubmissionError) Local persistence/storage failure.
 * @returns (Effect.Effect<void>) Contained logging effect.
 */
const handlePostSubmissionFailure = (
  job: Job,
  remoteJobId: string,
  error: PostSubmissionError,
): Effect.Effect<void> =>
  Effect.logError("remote-bound worker deferred to lease recovery", {
    errorTag: error._tag,
    jobId: job.id,
    remoteJobId,
  });

/**
 * Repeatedly binds a submitted remote job until durable storage is available.
 *
 * @param job - (Job) Claimed platform job.
 * @param reservation - (EngineReservation) Held engine reservation.
 * @param submission - (EngineSubmission) Accepted remote job.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<Option.Option<Job>, DatabaseError>) Bound durable job.
 */
const bindSubmittedJob = (
  job: Job,
  reservation: EngineReservation,
  submission: EngineSubmission,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<Option.Option<Job>, DatabaseError> => {
  const bindAttempt: Effect.Effect<Option.Option<Job>, DatabaseError> = Effect.gen(
    function* bindSubmittedJobEffect(): Generator<unknown, Option.Option<Job>> {
      const leaseUntil: string = yield* createLeaseDeadline(
        dependencies.config.queue.leaseSeconds,
      );
      return yield* dependencies.repository.bindRemote(
        job.id,
        reservation.engine.id,
        submission.id,
        leaseUntil,
      );
    },
  );
  return Effect.retry(
    bindAttempt,
    Schedule.spaced(
      Duration.seconds(dependencies.config.queue.recoveryIntervalSeconds),
    ),
  );
};

/**
 * Cancels remote work that cannot be associated with a running durable job.
 *
 * @param reservation - (EngineReservation) Held engine reservation.
 * @param remoteJobId - (string) Remote inference identifier.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void>) Best-effort remote cancellation.
 */
const cancelUnboundRemoteJob = (
  reservation: EngineReservation,
  remoteJobId: string,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> =>
  dependencies.gateway.cancel(reservation.engine, remoteJobId).pipe(
    Effect.tap((): Effect.Effect<void> =>
      dependencies.pool.recordSuccess(reservation.engine.id),
    ),
    Effect.catchAll((error: EngineGatewayError): Effect.Effect<void> =>
      dependencies.pool.recordFailure(reservation.engine.id).pipe(
        Effect.zipRight(
          Effect.logWarning("unbound remote job cancellation failed", {
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
 * @param job - (Job) Claimed platform job.
 * @param reservation - (EngineReservation) Held engine reservation.
 * @param submission - (EngineSubmission) Accepted remote job.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<Option.Option<Job>>) Durable bound job when still claimable.
 */
const bindOrCancelSubmittedJob = (
  job: Job,
  reservation: EngineReservation,
  submission: EngineSubmission,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<Option.Option<Job>> =>
  Effect.either(
    bindSubmittedJob(job, reservation, submission, dependencies).pipe(
      Effect.onInterrupt((): Effect.Effect<void> =>
        cancelUnboundRemoteJob(reservation, submission.id, dependencies),
      ),
    ),
  ).pipe(
    Effect.flatMap(
      (
        result: Either.Either<Option.Option<Job>, DatabaseError>,
      ): Effect.Effect<Option.Option<Job>> => {
        if (Either.isLeft(result)) {
          return handlePostSubmissionFailure(job, submission.id, result.left).pipe(
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
 * @param job - (Job) Durable remote-bound job.
 * @param reservation - (EngineReservation) Held engine reservation.
 * @param submission - (EngineSubmission) Accepted remote job.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void>) Contained remote polling lifecycle.
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
    Effect.catchAll((error: PostSubmissionError): Effect.Effect<void> =>
      handlePostSubmissionFailure(job, submission.id, error),
    ),
  );

export {
  bindOrCancelSubmittedJob,
  bindSubmittedJob,
  cancelUnboundRemoteJob,
  handlePostSubmissionFailure,
  handleSubmissionFailure,
  pollBoundSubmission,
};
export type { PostSubmissionError };
