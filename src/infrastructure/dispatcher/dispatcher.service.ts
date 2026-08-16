import { ConfigService } from "@app/core/config/config.service";
import type { DatabaseError } from "@app/core/errors/error.types";
import { EffectConcurrency } from "@app/core/runtime/runtime.constants";
import { ServiceTag } from "@app/core/runtime/service.constants";
import { JobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import {
  DispatcherMessage,
  DispatcherRecoveryScope,
} from "@app/infrastructure/dispatcher/dispatcher.constants";
import { createLeaseDeadline } from "@app/infrastructure/dispatcher/dispatcher.helpers";
import type { DispatcherShape } from "@app/infrastructure/dispatcher/dispatcher.interface";
import type { DispatcherWorkerDependencies } from "@app/infrastructure/dispatcher/dispatcher.types";
import {
  type DispatcherRecoveryScopeValue,
  recoverRunningJobs,
} from "@app/infrastructure/dispatcher/stages/dispatcher-recovery.service";
import { processClaimedJob } from "@app/infrastructure/dispatcher/stages/dispatcher-worker.service";
import { EngineGateway } from "@app/infrastructure/engine/engine.service";
import type { EngineReservation } from "@app/infrastructure/engine/engine.types";
import { EnginePool } from "@app/infrastructure/engine/pool/engine-pool.service";
import { ResultStorage } from "@app/infrastructure/storage/storage.service";
import type { Job, QueuedJobHead } from "@app/modules/jobs/job.types";
import { Duration, Effect, Option, Schedule } from "effect";

/**
 * Claims and forks at most one queued job during a scheduler iteration.
 *
 * @param {DispatcherWorkerDependencies} dependencies - Scheduler dependencies.
 * @returns {Effect.Effect<void, DatabaseError>} One durable scheduling iteration.
 */
const dispatchOne = (
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError> =>
  Effect.gen(function* dispatchOneEffect() {
    const headOption: Option.Option<QueuedJobHead> =
      yield* dependencies.repository.peekNextQueued();
    if (Option.isNone(headOption)) return;
    const reservationOption: Option.Option<EngineReservation> =
      yield* dependencies.pool.reserve(headOption.value.model);
    if (Option.isNone(reservationOption)) return;
    const leaseUntil: string = yield* createLeaseDeadline(
      dependencies.config.queue.leaseSeconds,
    );
    const claimedOption: Option.Option<Job> =
      yield* dependencies.repository.claim(
        headOption.value.id,
        leaseUntil,
        dependencies.config.queue.maxRunningJobs,
      );
    if (Option.isNone(claimedOption)) {
      yield* dependencies.pool.release(reservationOption.value.engine.id);
      return;
    }
    yield* Effect.fork(
      processClaimedJob(
        claimedOption.value,
        reservationOption.value,
        dependencies,
      ),
    );
  });

/**
 * Converts a scheduler iteration into an error-contained operational loop step.
 *
 * @param {DispatcherWorkerDependencies} dependencies - Scheduler dependencies.
 * @returns {Effect.Effect<void>} Safe scheduling step.
 */
const safeDispatchOne = (
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> =>
  dispatchOne(dependencies).pipe(
    Effect.catchAll(
      (error: DatabaseError): Effect.Effect<void> =>
        Effect.logError(DispatcherMessage.iterationFailed, {
          errorTag: error._tag,
        }),
    ),
  );

/**
 * Contains repository failures from one dispatcher recovery pass.
 *
 * @param {DispatcherWorkerDependencies} dependencies - Scheduler dependencies.
 * @param {DispatcherRecoveryScopeValue} scope - Startup or expired-lease scope.
 * @returns {Effect.Effect<void>} Safe recovery operation.
 */
const safeRecoverRunningJobs = (
  dependencies: DispatcherWorkerDependencies,
  scope: DispatcherRecoveryScopeValue,
): Effect.Effect<void> =>
  recoverRunningJobs(dependencies, scope).pipe(
    Effect.catchAll(
      (error: DatabaseError): Effect.Effect<void> =>
        Effect.logError(DispatcherMessage.recoveryFailed, {
          errorTag: error._tag,
          scope,
        }),
    ),
  );

/**
 * Builds the long-lived dispatcher implementation.
 *
 * Both loops are plain effects driven by an explicit `Schedule`, so their
 * cadence is data rather than hand-rolled sleep/recurse plumbing.
 *
 * @param {DispatcherWorkerDependencies} dependencies - Captured services.
 * @returns {DispatcherShape} Long-running dispatcher implementation.
 */
const createDispatcher = (
  dependencies: DispatcherWorkerDependencies,
): DispatcherShape => {
  const dispatchLoop: Effect.Effect<number> = safeDispatchOne(
    dependencies,
  ).pipe(
    Effect.repeat(
      Schedule.spaced(
        Duration.millis(dependencies.config.queue.pollIntervalMs),
      ),
    ),
  );
  const recoveryLoop: Effect.Effect<number> = safeRecoverRunningJobs(
    dependencies,
    DispatcherRecoveryScope.expiredOnly,
  ).pipe(
    Effect.repeat(
      Schedule.spaced(
        Duration.seconds(dependencies.config.queue.recoveryIntervalSeconds),
      ),
    ),
  );
  return {
    run: safeRecoverRunningJobs(
      dependencies,
      DispatcherRecoveryScope.allRunning,
    ).pipe(
      Effect.zipRight(
        Effect.all([dispatchLoop, recoveryLoop], {
          concurrency: EffectConcurrency.unbounded,
          discard: true,
        }),
      ),
    ),
  };
};

/** Durable asynchronous dispatcher started with the application runtime. */
class Dispatcher extends Effect.Service<Dispatcher>()(ServiceTag.dispatcher, {
  scoped: Effect.gen(function* dispatcherService() {
    const dependencies: DispatcherWorkerDependencies = {
      config: yield* ConfigService,
      gateway: yield* EngineGateway,
      pool: yield* EnginePool,
      repository: yield* JobRepository,
      storage: yield* ResultStorage,
    };
    const dispatcher: DispatcherShape = createDispatcher(dependencies);
    yield* Effect.forkScoped(dispatcher.run);
    return dispatcher;
  }),
}) {}

export {
  createDispatcher,
  Dispatcher,
  dispatchOne,
  safeDispatchOne,
  safeRecoverRunningJobs,
};
