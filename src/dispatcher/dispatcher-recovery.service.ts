import { Clock, Effect, Option } from "effect";

import { retryOrFailJob } from "@app/dispatcher/dispatcher-persistence.service.js";
import type { DispatcherWorkerDependencies } from "@app/dispatcher/dispatcher.types.js";
import { resumeClaimedJob } from "@app/dispatcher/dispatcher-worker.service.js";
import type { EngineReservation } from "@app/engine/engine.types.js";
import type { DatabaseError } from "@app/error/error.types.js";
import type { Job } from "@app/job/job.types.js";

/** Recovery scope used to distinguish process startup from periodic lease repair. */
type DispatcherRecoveryScope = "all-running" | "expired-only";

/** Stable recovery scope literals. */
const DISPATCHER_RECOVERY_SCOPE = {
  ALL_RUNNING: "all-running",
  EXPIRED_ONLY: "expired-only",
} as const satisfies Readonly<Record<string, DispatcherRecoveryScope>>;

/**
 * Tests whether a running job should be handled in one recovery pass.
 *
 * @param job - (Job) Durable running job.
 * @param nowIso - (string) Current ISO-8601 timestamp.
 * @param scope - (DispatcherRecoveryScope) Requested recovery scope.
 * @returns (boolean) Whether the job is eligible for this pass.
 */
const shouldRecoverJob = (
  job: Job,
  nowIso: string,
  scope: DispatcherRecoveryScope,
): boolean =>
  scope === DISPATCHER_RECOVERY_SCOPE.ALL_RUNNING ||
  job.leaseUntil === undefined ||
  job.leaseUntil <= nowIso;

/**
 * Returns an incomplete running job to the normal bounded retry policy.
 *
 * @param job - (Job) Running job without complete remote metadata.
 * @param dependencies - (DispatcherWorkerDependencies) Dispatcher dependencies.
 * @returns (Effect.Effect<void, DatabaseError>) Durable retry/failure transition.
 */
const recoverIncompleteJob = (
  job: Job,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError> => retryOrFailJob(job, dependencies);

/**
 * Reacquires capacity and resumes an existing remote inference job.
 *
 * @param job - (Job) Running job with complete remote metadata.
 * @param dependencies - (DispatcherWorkerDependencies) Dispatcher dependencies.
 * @returns (Effect.Effect<void>) Recovery scheduling effect.
 */
const recoverRemoteJob = (
  job: Job,
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> => {
  const engineId: string | undefined = job.engineId;
  const remoteJobId: string | undefined = job.remoteJobId;
  if (engineId === undefined || remoteJobId === undefined) {
    return recoverIncompleteJob(job, dependencies).pipe(
      Effect.catchAll((error: DatabaseError): Effect.Effect<void> =>
        Effect.logError("incomplete job recovery failed", {
          errorTag: error._tag,
          jobId: job.id,
        }),
      ),
    );
  }
  return dependencies.pool.reserveById(engineId, job.request.model).pipe(
    Effect.flatMap(
      (
        reservationOption: Option.Option<EngineReservation>,
      ): Effect.Effect<void> => {
        if (Option.isNone(reservationOption)) {
          return Effect.logWarning("remote job recovery deferred", {
            engineId,
            jobId: job.id,
          });
        }
        return Effect.fork(
          resumeClaimedJob(
            job,
            reservationOption.value,
            remoteJobId,
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
 * @param dependencies - (DispatcherWorkerDependencies) Dispatcher dependencies.
 * @param scope - (DispatcherRecoveryScope) Startup or expired-lease scope.
 * @returns (Effect.Effect<void, DatabaseError>) Recovery pass.
 */
const recoverRunningJobs = (
  dependencies: DispatcherWorkerDependencies,
  scope: DispatcherRecoveryScope,
): Effect.Effect<void, DatabaseError> =>
  Effect.gen(function* recoverRunningJobsEffect(): Generator<unknown, void> {
    const nowEpochMs: number = yield* Clock.currentTimeMillis;
    const nowIso: string = new Date(nowEpochMs).toISOString();
    const jobs: readonly Job[] = yield* dependencies.repository.listRunning();
    const recoverableJobs: readonly Job[] = jobs.filter(
      (job: Job): boolean => shouldRecoverJob(job, nowIso, scope),
    );
    yield* Effect.forEach(
      recoverableJobs,
      (job: Job): Effect.Effect<void> => recoverRemoteJob(job, dependencies),
      { concurrency: 1, discard: true },
    );
  });

export {
  DISPATCHER_RECOVERY_SCOPE,
  recoverRemoteJob,
  recoverRunningJobs,
  shouldRecoverJob,
};
export type { DispatcherRecoveryScope };
