import { Duration, Effect, Either, Option } from "effect";

import { createLeaseDeadline } from "@app/dispatcher/dispatcher.helpers.js";
import {
  persistCompletedJob,
  persistRemoteCancellation,
  persistRemoteFailure,
  persistStorageFailure,
} from "@app/dispatcher/dispatcher-persistence.service.js";
import type {
  DispatcherPollContext,
  DispatcherWorkerDependencies,
} from "@app/dispatcher/dispatcher.types.js";
import { ENGINE_JOB_STATUS } from "@app/engine/engine.constants.js";
import { JOB_STATUS } from "@app/job/job.constants.js";
import type { EngineGatewayError } from "@app/engine/engine.interface.js";
import type { EngineJob } from "@app/engine/engine.types.js";
import {
  type DatabaseError,
  type StorageError,
} from "@app/error/error.types.js";
import type { Job } from "@app/job/job.types.js";

/** Remote poll result preserved as a typed value for circuit-breaker logic. */
type RemotePollResult = Either.Either<EngineJob, EngineGatewayError>;

/** Optional remote poll result; none means local durable ownership was lost. */
type RemotePollDecision = Option.Option<RemotePollResult>;

/**
 * Calls the appropriate upstream operation after renewing the durable lease.
 *
 * @param job - (Job) Running platform job.
 * @param context - (DispatcherPollContext) Remote polling state.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<RemotePollDecision, DatabaseError>) Remote result or local stop decision.
 */
const fetchRemoteJob = (
  job: Job,
  context: DispatcherPollContext,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<RemotePollDecision, DatabaseError> =>
  Effect.gen(
    function* fetchRemoteJobEffect(): Generator<unknown, RemotePollDecision> {
      yield* Effect.sleep(
        Duration.millis(dependencies.config.queue.pollIntervalMs),
      );
      const currentOption: Option.Option<Job> =
        yield* dependencies.repository.getById(job.id);
      if (Option.isNone(currentOption)) {
        return Option.none<RemotePollResult>();
      }
      const current: Job = currentOption.value;
      if (current.status !== JOB_STATUS.RUNNING) {
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
    },
  );

/**
 * Handles a successful remote response and reports whether polling is terminal.
 *
 * @param job - (Job) Running platform job.
 * @param remoteJob - (EngineJob) Decoded upstream response.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<boolean, DatabaseError | StorageError>) True for terminal states.
 */
const handleRemoteJob = (
  job: Job,
  remoteJob: EngineJob,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<boolean, DatabaseError | StorageError> => {
  switch (remoteJob.status) {
    case ENGINE_JOB_STATUS.CANCELLED:
      return persistRemoteCancellation(job, dependencies).pipe(Effect.as(true));
    case ENGINE_JOB_STATUS.FAILED:
      return persistRemoteFailure(job, remoteJob, dependencies).pipe(
        Effect.as(true),
      );
    case ENGINE_JOB_STATUS.SUCCEEDED:
      return persistCompletedJob(job, remoteJob, dependencies).pipe(
        Effect.catchTag(
          "StorageError",
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
 * @param job - (Job) Running platform job.
 * @param context - (DispatcherPollContext) Poll state.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void, DatabaseError | StorageError>) Next poll or retry transition.
 */
const handlePollFailure = (
  job: Job,
  context: DispatcherPollContext,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError | StorageError> =>
  Effect.gen(
    function* handlePollFailureEffect(): Generator<unknown, void> {
      yield* dependencies.pool.recordFailure(context.engine.id);
      const failures: number = context.consecutiveFailures + 1;
      if (failures >= context.engine.circuitBreaker.failureThreshold) {
        yield* Effect.logWarning("remote polling deferred to lease recovery", {
          engineId: context.engine.id,
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
    },
  );

/**
 * Handles one successful upstream polling response.
 *
 * @param job - (Job) Running platform job.
 * @param remoteJob - (EngineJob) Decoded upstream job.
 * @param context - (DispatcherPollContext) Poll state.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void, DatabaseError | StorageError>) Terminal persistence or next poll.
 */
const handlePollSuccess = (
  job: Job,
  remoteJob: EngineJob,
  context: DispatcherPollContext,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError | StorageError> =>
  Effect.gen(
    function* handlePollSuccessEffect(): Generator<unknown, void> {
      yield* dependencies.pool.recordSuccess(context.engine.id);
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
    },
  );

/**
 * Polls one submitted engine job until a terminal state is durable.
 *
 * @param job - (Job) Running platform job.
 * @param context - (DispatcherPollContext) Remote polling state.
 * @param dependencies - (DispatcherWorkerDependencies) Worker dependencies.
 * @returns (Effect.Effect<void, DatabaseError | StorageError>) Poll lifecycle effect.
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
                  onLeft: (): Effect.Effect<
                    void,
                    DatabaseError | StorageError
                  > => handlePollFailure(job, context, dependencies),
                  onRight: (
                    remoteJob: EngineJob,
                  ): Effect.Effect<void, DatabaseError | StorageError> =>
                    handlePollSuccess(job, remoteJob, context, dependencies),
                }),
            }),
        ),
      ),
  );

export { fetchRemoteJob, handleRemoteJob, pollRemoteJob };
export type { RemotePollDecision, RemotePollResult };
