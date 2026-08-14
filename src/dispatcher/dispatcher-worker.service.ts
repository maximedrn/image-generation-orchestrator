import { Effect, Either, Option } from "effect";

import { createLeaseDeadline } from "@app/dispatcher/dispatcher.helpers.js";
import { pollRemoteJob } from "@app/dispatcher/dispatcher-poll.service.js";
import {
  bindOrCancelSubmittedJob,
  handlePostSubmissionFailure,
  handleSubmissionFailure,
  pollBoundSubmission,
} from "@app/dispatcher/dispatcher-submission.service.js";
import type {
  DispatcherWorkerDependencies,
} from "@app/dispatcher/dispatcher.types.js";
import type { EngineGatewayError } from "@app/engine/engine.interface.js";
import type { EngineReservation, EngineSubmission } from "@app/engine/engine.types.js";
import type { Job } from "@app/job/job.types.js";
import type { PostSubmissionError } from "@app/dispatcher/dispatcher-submission.service.js";

/**
 * Submits one claimed job and owns its engine reservation until completion.
 *
 * @param job - (Job) Atomically claimed durable job.
 * @param reservation - (EngineReservation) Scheduler capacity reservation.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void>) Worker effect with failures contained.
 */
const processClaimedJob = (
  job: Job,
  reservation: EngineReservation,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> => {
  const lifecycle: Effect.Effect<void> = Effect.gen(
    function* processClaimedJobEffect(): Generator<unknown, void> {
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
 * @param job - (Job) Durable running platform job.
 * @param reservation - (EngineReservation) Reacquired scheduler reservation.
 * @param remoteJobId - (string) Existing remote inference job identifier.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void>) Recovery worker with failures contained.
 */
const resumeClaimedJob = (
  job: Job,
  reservation: EngineReservation,
  remoteJobId: string,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> => {
  const worker: Effect.Effect<void, PostSubmissionError> = Effect.gen(
    function* resumeClaimedJobEffect(): Generator<unknown, void> {
      const leaseUntil: string = yield* createLeaseDeadline(
        dependencies.config.queue.leaseSeconds,
      );
      const renewed: boolean = yield* dependencies.repository.renewLease(
        job.id,
        leaseUntil,
      );
      if (!renewed) {
        yield* Effect.logWarning("recovery lease ownership was lost", {
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
    Effect.catchAll((error: PostSubmissionError): Effect.Effect<void> =>
      handlePostSubmissionFailure(job, remoteJobId, error),
    ),
    Effect.ensuring(dependencies.pool.release(reservation.engine.id)),
  );
};

export { processClaimedJob, resumeClaimedJob };
