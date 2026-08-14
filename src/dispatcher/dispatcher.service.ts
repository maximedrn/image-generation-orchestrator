import { Context, Duration, Effect, Layer, Option } from "effect";

import { EFFECT_SERVICE_IDENTIFIER } from "@app/runtime/runtime.constants.js";
import { ConfigService } from "@app/config/config.service.js";
import type { PlatformConfig } from "@app/config/config.types.js";
import { createLeaseDeadline } from "@app/dispatcher/dispatcher.helpers.js";
import {
  DISPATCHER_RECOVERY_SCOPE,
  recoverRunningJobs,
  type DispatcherRecoveryScope,
} from "@app/dispatcher/dispatcher-recovery.service.js";
import type { DispatcherShape } from "@app/dispatcher/dispatcher.interface.js";
import type { DispatcherWorkerDependencies } from "@app/dispatcher/dispatcher.types.js";
import { processClaimedJob } from "@app/dispatcher/dispatcher-worker.service.js";
import type {
  EngineGatewayShape,
  EnginePoolShape,
} from "@app/engine/engine.interface.js";
import { EnginePool } from "@app/engine/engine-pool.service.js";
import { EngineGateway } from "@app/engine/engine.service.js";
import type { EngineReservation } from "@app/engine/engine.types.js";
import type { DatabaseError } from "@app/error/error.types.js";
import type { JobRepositoryShape } from "@app/job/job-repository.interface.js";
import { JobRepository } from "@app/job/job-repository.service.js";
import type { Job, QueuedJobHead } from "@app/job/job.types.js";
import type { ResultStorageShape } from "@app/storage/storage.interface.js";
import { ResultStorage } from "@app/storage/storage.service.js";

/** Effect Context tag for the durable asynchronous dispatcher. */
class Dispatcher extends Context.Tag(EFFECT_SERVICE_IDENTIFIER.DISPATCHER)<
  Dispatcher,
  DispatcherShape
>() {}

/**
 * Claims and forks at most one queued job during a scheduler iteration.
 *
 * @param dependencies - (DispatcherWorkerDependencies) Scheduler dependencies.
 * @returns (Effect.Effect<void, DatabaseError>) One durable scheduling iteration.
 */
const dispatchOne = (
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void, DatabaseError> =>
  Effect.gen(function* dispatchOneEffect(): Generator<unknown, void> {
    const headOption: Option.Option<QueuedJobHead> =
      yield* dependencies.repository.peekNextQueued();
    if (Option.isNone(headOption)) {
      return;
    }
    const reservationOption: Option.Option<EngineReservation> =
      yield* dependencies.pool.reserve(headOption.value.model);
    if (Option.isNone(reservationOption)) {
      return;
    }
    const leaseUntil: string = yield* createLeaseDeadline(
      dependencies.config.queue.leaseSeconds,
    );
    const claimedOption: Option.Option<Job> = yield* dependencies.repository.claim(
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
 * @param dependencies - (DispatcherWorkerDependencies) Scheduler dependencies.
 * @returns (Effect.Effect<void>) Safe scheduling step.
 */
const safeDispatchOne = (
  dependencies: DispatcherWorkerDependencies,
): Effect.Effect<void> =>
  dispatchOne(dependencies).pipe(
    Effect.catchAll((error: DatabaseError): Effect.Effect<void> =>
      Effect.logError("dispatcher iteration failed", { errorTag: error._tag }),
    ),
  );

/**
 * Contains repository failures from one dispatcher recovery pass.
 *
 * @param dependencies - (DispatcherWorkerDependencies) Scheduler dependencies.
 * @param scope - (DispatcherRecoveryScope) Startup or expired-lease scope.
 * @returns (Effect.Effect<void>) Safe recovery operation.
 */
const safeRecoverRunningJobs = (
  dependencies: DispatcherWorkerDependencies,
  scope: DispatcherRecoveryScope,
): Effect.Effect<void> =>
  recoverRunningJobs(dependencies, scope).pipe(
    Effect.catchAll((error: DatabaseError): Effect.Effect<void> =>
      Effect.logError("dispatcher recovery failed", {
        errorTag: error._tag,
        scope,
      }),
    ),
  );

/**
 * Builds the long-lived dispatcher implementation.
 *
 * @param dependencies - (DispatcherWorkerDependencies) Captured services.
 * @returns (DispatcherShape) Long-running dispatcher implementation.
 */
const createDispatcher = (
  dependencies: DispatcherWorkerDependencies,
): DispatcherShape => {
  const dispatchIteration: Effect.Effect<void> = safeDispatchOne(
    dependencies,
  ).pipe(
    Effect.zipRight(
      Effect.sleep(Duration.millis(dependencies.config.queue.pollIntervalMs)),
    ),
  );
  const recoveryIteration: Effect.Effect<void> = Effect.sleep(
    Duration.seconds(dependencies.config.queue.recoveryIntervalSeconds),
  ).pipe(
    Effect.zipRight(
      safeRecoverRunningJobs(
        dependencies,
        DISPATCHER_RECOVERY_SCOPE.EXPIRED_ONLY,
      ),
    ),
  );
  const loops: Effect.Effect<void> = Effect.all(
    [Effect.forever(dispatchIteration), Effect.forever(recoveryIteration)],
    { concurrency: "unbounded", discard: true },
  );
  const run: Effect.Effect<void> = safeRecoverRunningJobs(
    dependencies,
    DISPATCHER_RECOVERY_SCOPE.ALL_RUNNING,
  ).pipe(Effect.zipRight(loops));
  return { run };
};

/** Live dispatcher layer with all infrastructure captured once. */
const DispatcherLive: Layer.Layer<
  Dispatcher,
  never,
  ConfigService | EngineGateway | EnginePool | JobRepository | ResultStorage
> = Layer.scoped(
  Dispatcher,
  Effect.gen(function* dispatcherLayerEffect(): Generator<unknown, DispatcherShape> {
    const config: PlatformConfig = yield* ConfigService;
    const repository: JobRepositoryShape = yield* JobRepository;
    const gateway: EngineGatewayShape = yield* EngineGateway;
    const pool: EnginePoolShape = yield* EnginePool;
    const storage: ResultStorageShape = yield* ResultStorage;
    const dependencies: DispatcherWorkerDependencies = {
      config,
      gateway,
      pool,
      repository,
      storage,
    };
    const dispatcher: DispatcherShape = createDispatcher(dependencies);
    yield* Effect.forkScoped(dispatcher.run);
    return dispatcher;
  }),
);

export {
  createDispatcher,
  dispatchOne,
  Dispatcher,
  DispatcherLive,
  safeRecoverRunningJobs,
};
