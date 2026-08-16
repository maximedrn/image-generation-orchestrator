import { DispatcherMessage } from "@app/infrastructure/dispatcher/dispatcher.constants";
import { createLeaseDeadline } from "@app/infrastructure/dispatcher/dispatcher.helpers";
import type { DispatcherWorkerDependencies } from "@app/infrastructure/dispatcher/dispatcher.types";
import { pollRemoteJob } from "@app/infrastructure/dispatcher/stages/dispatcher-poll.service";
import type { PostSubmissionError } from "@app/infrastructure/dispatcher/stages/dispatcher-submission.service";
import {
  bindOrCancelSubmittedJob,
  handlePostSubmissionFailure,
  handleSubmissionFailure,
  pollBoundSubmission,
} from "@app/infrastructure/dispatcher/stages/dispatcher-submission.service";
import type { EngineGatewayError } from "@app/infrastructure/engine/engine.interface";
import type {
  EngineReservation,
  EngineSubmission,
} from "@app/infrastructure/engine/engine.types";
import type { Job } from "@app/modules/jobs/job.types";
import { Effect, Either, Option } from "effect";

/**
 * Submits one claimed job and owns its engine reservation until completion.
 *
 * @param {Job} job - Atomically claimed durable job.
 * @param {EngineReservation} reservation - Scheduler capacity reservation.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void>} Worker effect with failures contained.
 */
const processClaimedJob = (
  job: Job,
  reservation: EngineReservation,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> => {
  const lifecycle: Effect.Effect<void> = Effect.gen(
    function* processClaimedJobEffect() {
      const submitted: Either.Either<EngineSubmission, EngineGatewayError> =
        yield* Effect.either(
          dependencies.gateway.submit(reservation.engine, job.request),
        );
      if (Either.isLeft(submitted)) {
        yield* handleSubmissionFailure(
          job,
          reservation,
          submitted.left,
          dependencies,
        );
        return;
      }
      yield* dependencies.pool.recordSuccess(reservation.engine.id);
      const boundOption: Option.Option<Job> = yield* bindOrCancelSubmittedJob(
        job,
        reservation,
        submitted.right,
        dependencies,
      );
      if (Option.isNone(boundOption)) {
        return;
      }
      yield* pollBoundSubmission(
        boundOption.value,
        reservation,
        submitted.right,
        dependencies,
      );
    },
  );
  return lifecycle.pipe(
    Effect.ensuring(dependencies.pool.release(reservation.engine.id)),
  );
};

/**
 * Resumes polling of an already-submitted remote job after dispatcher recovery.
 *
 * @param {Job} job - Durable running platform job.
 * @param {EngineReservation} reservation - Reacquired scheduler reservation.
 * @param {string} remoteJobId - Existing remote inference job identifier.
 * @param {DispatcherWorkerDependencies} dependencies - Worker dependencies.
 * @returns {Effect.Effect<void>} Recovery worker with failures contained.
 */
const resumeClaimedJob = (
  job: Job,
  reservation: EngineReservation,
  remoteJobId: string,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> => {
  const worker: Effect.Effect<void, PostSubmissionError> = Effect.gen(
    function* resumeClaimedJobEffect() {
      const leaseUntil: string = yield* createLeaseDeadline(
        dependencies.config.queue.leaseSeconds,
      );
      const renewed: boolean = yield* dependencies.repository.renewLease(
        job.id,
        leaseUntil,
      );
      if (!renewed) {
        yield* Effect.logWarning(DispatcherMessage.leaseOwnershipLost, {
          engineId: reservation.engine.id,
          jobId: job.id,
          remoteJobId,
        });
        return;
      }
      yield* pollRemoteJob(
        job,
        { consecutiveFailures: 0, engine: reservation.engine, remoteJobId },
        dependencies,
      );
    },
  );
  return worker.pipe(
    Effect.catchAll(
      (error: PostSubmissionError): Effect.Effect<void> =>
        handlePostSubmissionFailure(job, remoteJobId, error),
    ),
    Effect.ensuring(dependencies.pool.release(reservation.engine.id)),
  );
};

export { processClaimedJob, resumeClaimedJob };
