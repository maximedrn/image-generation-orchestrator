import type { PlatformConfig } from "@app/core/config/config.types";
import type { EnginePoolShape } from "@app/infrastructure/engine/engine.interface";
import type {
  EngineReservation,
  EngineRuntimeState,
  EngineView,
} from "@app/infrastructure/engine/engine.types";
import {
  recordEngineFailure,
  recordEngineSuccess,
  releaseEngineReservation,
  reserveEngine,
  reserveEngineById,
  toEngineViews,
} from "@app/infrastructure/engine/pool/engine-pool.helpers";
import { Clock, Effect, type Option, Ref } from "effect";

/**
 * Reads public engine scheduler views from the atomic state reference.
 *
 * @param {PlatformConfig} config - Runtime platform configuration.
 * @param {Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>} stateRef - Scheduler state.
 * @returns {Effect.Effect<readonly EngineView[]>} Public scheduler views.
 */
const listEngines = (
  config: PlatformConfig,
  stateRef: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>,
): Effect.Effect<readonly EngineView[]> =>
  Ref.get(stateRef).pipe(
    Effect.map(
      (
        states: ReadonlyMap<string, EngineRuntimeState>,
      ): readonly EngineView[] => toEngineViews(config, states),
    ),
  );

/**
 * Records one upstream failure against an engine circuit breaker.
 *
 * @param {PlatformConfig} config - Runtime platform configuration.
 * @param {Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>} stateRef - Scheduler state.
 * @param {string} engineId - Engine identifier.
 * @returns {Effect.Effect<void>} Atomic state update.
 */
const markEngineFailure = (
  config: PlatformConfig,
  stateRef: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>,
  engineId: string,
): Effect.Effect<void> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap(
      (nowEpochMs: number): Effect.Effect<void> =>
        Ref.update(
          stateRef,
          (
            states: ReadonlyMap<string, EngineRuntimeState>,
          ): ReadonlyMap<string, EngineRuntimeState> =>
            recordEngineFailure(config, states, engineId, nowEpochMs),
        ),
    ),
  );

/**
 * Records one successful probe or request for an engine.
 *
 * @param {Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>} stateRef - Scheduler state.
 * @param {string} engineId - Engine identifier.
 * @returns {Effect.Effect<void>} Atomic state update.
 */
const markEngineSuccess = (
  stateRef: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>,
  engineId: string,
): Effect.Effect<void> =>
  Ref.update(
    stateRef,
    (
      states: ReadonlyMap<string, EngineRuntimeState>,
    ): ReadonlyMap<string, EngineRuntimeState> =>
      recordEngineSuccess(states, engineId),
  );

/**
 * Releases one scheduler capacity reservation.
 *
 * @param {Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>} stateRef - Scheduler state.
 * @param {string} engineId - Engine identifier.
 * @returns {Effect.Effect<void>} Atomic state update.
 */
const releaseEngine = (
  stateRef: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>,
  engineId: string,
): Effect.Effect<void> =>
  Ref.update(
    stateRef,
    (
      states: ReadonlyMap<string, EngineRuntimeState>,
    ): ReadonlyMap<string, EngineRuntimeState> =>
      releaseEngineReservation(states, engineId),
  );

/**
 * Reserves the least-loaded compatible engine.
 *
 * @param {PlatformConfig} config - Runtime platform configuration.
 * @param {Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>} stateRef - Scheduler state.
 * @param {string} model - Requested public model alias.
 * @returns {Effect.Effect<Option.Option<EngineReservation>>} Atomic reservation.
 */
const reserveCompatibleEngine = (
  config: PlatformConfig,
  stateRef: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>,
  model: string,
): Effect.Effect<Option.Option<EngineReservation>> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap(
      (nowEpochMs: number): Effect.Effect<Option.Option<EngineReservation>> =>
        Ref.modify(
          stateRef,
          (
            states: ReadonlyMap<string, EngineRuntimeState>,
          ): readonly [
            Option.Option<EngineReservation>,
            ReadonlyMap<string, EngineRuntimeState>,
          ] => reserveEngine(config, states, model, nowEpochMs),
        ),
    ),
  );

/**
 * Reserves a specific engine for durable remote-job recovery.
 *
 * @param {PlatformConfig} config - Runtime platform configuration.
 * @param {Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>} stateRef - Scheduler state.
 * @param {string} engineId - Required engine identifier.
 * @param {string} model - Requested public model alias.
 * @returns {Effect.Effect<Option.Option<EngineReservation>>} Atomic reservation.
 */
const reserveSpecificEngine = (
  config: PlatformConfig,
  stateRef: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>,
  engineId: string,
  model: string,
): Effect.Effect<Option.Option<EngineReservation>> =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap(
      (nowEpochMs: number): Effect.Effect<Option.Option<EngineReservation>> =>
        Ref.modify(
          stateRef,
          (
            states: ReadonlyMap<string, EngineRuntimeState>,
          ): readonly [
            Option.Option<EngineReservation>,
            ReadonlyMap<string, EngineRuntimeState>,
          ] => reserveEngineById(config, states, engineId, model, nowEpochMs),
        ),
    ),
  );

/**
 * Builds the atomic in-memory scheduler implementation.
 *
 * @param {PlatformConfig} config - Resolved platform configuration.
 * @param {Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>} stateRef - State reference.
 * @returns {EnginePoolShape} Scheduler implementation.
 */
const createEnginePool = (
  config: PlatformConfig,
  stateRef: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>,
): EnginePoolShape => ({
  list: (): Effect.Effect<readonly EngineView[]> =>
    listEngines(config, stateRef),
  recordFailure: (engineId: string): Effect.Effect<void> =>
    markEngineFailure(config, stateRef, engineId),
  recordSuccess: (engineId: string): Effect.Effect<void> =>
    markEngineSuccess(stateRef, engineId),
  release: (engineId: string): Effect.Effect<void> =>
    releaseEngine(stateRef, engineId),
  reserve: (model: string): Effect.Effect<Option.Option<EngineReservation>> =>
    reserveCompatibleEngine(config, stateRef, model),
  reserveById: (
    engineId: string,
    model: string,
  ): Effect.Effect<Option.Option<EngineReservation>> =>
    reserveSpecificEngine(config, stateRef, engineId, model),
});

export {
  createEnginePool,
  listEngines,
  markEngineFailure,
  markEngineSuccess,
  releaseEngine,
  reserveCompatibleEngine,
  reserveSpecificEngine,
};
