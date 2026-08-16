import type { DatabaseError } from "@app/core/errors/error.types";
import {
  DispatcherMessage,
  DispatcherRecoveryScope,
} from "@app/infrastructure/dispatcher/dispatcher.constants";
import type { DispatcherWorkerDependencies } from "@app/infrastructure/dispatcher/dispatcher.types";
import { retryOrFailJob } from "@app/infrastructure/dispatcher/stages/dispatcher-persistence.service";
import { resumeClaimedJob } from "@app/infrastructure/dispatcher/stages/dispatcher-worker.service";
import type { EngineReservation } from "@app/infrastructure/engine/engine.types";
import type { Job } from "@app/modules/jobs/job.types";
import { Clock, Effect, Option } from "effect";

/** Recovery scope used to distinguish process startup from periodic lease repair. */
type DispatcherRecoveryScopeValue =
  (typeof DispatcherRecoveryScope)[keyof typeof DispatcherRecoveryScope];

/**
 * Tests whether a running job should be handled in one recovery pass.
 *
 * @param {Job} job - Durable running job.
 * @param {string} nowIso - Current ISO-8601 timestamp.
 * @param {DispatcherRecoveryScopeValue} scope - Requested recovery scope.
 * @returns {boolean} Whether the job is eligible for this pass.
 */
const shouldRecoverJob = (
  job: Job,
  nowIso: string,
  scope: DispatcherRecoveryScopeValue,
): boolean =>
  scope === DispatcherRecoveryScope.allRunning ||
  Option.match(Option.fromNullable(job.leaseUntil), {
    onNone: (): boolean => true,
    onSome: (leaseUntil: string): boolean => leaseUntil <= nowIso,
  });

/**
 * Returns an incomplete running job to the normal bounded retry policy.
 *
 * @param {Job} job - Running job without complete remote metadata.
 * @param {DispatcherWorkerDependencies} dependencies - Dispatcher dependencies.
 * @returns {Effect.Effect<void, DatabaseError>} Durable retry/failure transition.
 */
const recoverIncompleteJob = (
  job: Job,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError> => retryOrFailJob(job, dependencies);

/**
 * Reacquires capacity and resumes an existing remote inference job.
 *
 * @param {Job} job - Running job with complete remote metadata.
 * @param {DispatcherWorkerDependencies} dependencies - Dispatcher dependencies.
 * @returns {Effect.Effect<void>} Recovery scheduling effect.
 */
const recoverRemoteJob = (
  job: Job,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> => {
  const engineIdOption: Option.Option<string> = Option.fromNullable(
    job.engineId,
  );
  const remoteJobIdOption: Option.Option<string> = Option.fromNullable(
    job.remoteJobId,
  );
  if (Option.isNone(engineIdOption) || Option.isNone(remoteJobIdOption)) {
    return recoverIncompleteJob(job, dependencies).pipe(
      Effect.catchAll(
        (error: DatabaseError): Effect.Effect<void> =>
          Effect.logError(DispatcherMessage.incompleteRecoveryFailed, {
            errorTag: error._tag,
            jobId: job.id,
          }),
      ),
    );
  }
  return dependencies.pool
    .reserveById(engineIdOption.value, job.request.model)
    .pipe(
      Effect.flatMap(
        (
          reservationOption: Option.Option<EngineReservation>,
        ): Effect.Effect<void> => {
          if (Option.isNone(reservationOption)) {
            return Effect.logWarning(DispatcherMessage.recoveryDeferred, {
              engineId: engineIdOption.value,
              jobId: job.id,
            });
          }
          return Effect.fork(
            resumeClaimedJob(
              job,
              reservationOption.value,
              remoteJobIdOption.value,
              dependencies,
            ),
          ).pipe(Effect.asVoid);
        },
      ),
    );
};

/**
 * Recovers durable running jobs without resubmitting existing remote work.
 *
 * @param {DispatcherWorkerDependencies} dependencies - Dispatcher dependencies.
 * @param {DispatcherRecoveryScopeValue} scope - Startup or expired-lease scope.
 * @returns {Effect.Effect<void, DatabaseError>} Recovery pass.
 */
const recoverRunningJobs = (
  dependencies: DispatcherWorkerDependencies,
  scope: DispatcherRecoveryScopeValue,
): Effect.Effect<void, DatabaseError> =>
  Effect.gen(function* recoverRunningJobsEffect() {
    const nowEpochMs: number = yield* Clock.currentTimeMillis;
    const nowIso: string = new Date(nowEpochMs).toISOString();
    const jobs: readonly Job[] = yield* dependencies.repository.listRunning();
    const recoverableJobs: readonly Job[] = jobs.filter((job: Job): boolean =>
      shouldRecoverJob(job, nowIso, scope),
    );
    yield* Effect.forEach(
      recoverableJobs,
      (job: Job): Effect.Effect<void> => recoverRemoteJob(job, dependencies),
      { concurrency: 1, discard: true },
    );
  });

export type { DispatcherRecoveryScopeValue };
export { recoverRemoteJob, recoverRunningJobs, shouldRecoverJob };
