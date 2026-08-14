import { Option } from "effect";

import type { EngineConfig, PlatformConfig } from "@app/config/config.types.js";
import { ENGINE_HEALTH, ENGINE_NUMERIC } from "@app/engine/engine.constants.js";
import { MILLISECONDS_PER_SECOND } from "@app/time/time.constants.js";
import type {
  EngineReservation,
  EngineRuntimeState,
  EngineView,
} from "@app/engine/engine.types.js";

/** Atomic state/result pair returned by an engine reservation attempt. */
type EngineReservationState = readonly [
  Option.Option<EngineReservation>,
  ReadonlyMap<string, EngineRuntimeState>,
];

/**
 * Creates initial scheduler state for every configured engine.
 *
 * @param engines - (readonly EngineConfig[]) Configured engine instances.
 * @returns (ReadonlyMap<string, EngineRuntimeState>) Initial state map.
 */
const createInitialEngineState = (
  engines: readonly EngineConfig[],
): ReadonlyMap<string, EngineRuntimeState> =>
  new Map<string, EngineRuntimeState>(
    engines.map(
      (engine: EngineConfig): readonly [string, EngineRuntimeState] => [
        engine.id,
        {
          consecutiveFailures: 0,
          health: ENGINE_HEALTH.HEALTHY,
          openUntilEpochMs: 0,
          running: ENGINE_NUMERIC.ZERO_RUNNING,
        },
      ],
    ),
  );

/**
 * Selects the least-loaded compatible engine with an available slot.
 *
 * @param engines - (readonly EngineConfig[]) Configured engines.
 * @param states - (ReadonlyMap<string, EngineRuntimeState>) Runtime states.
 * @param model - (string) Requested public model alias.
 * @param nowEpochMs - (number) Current clock time.
 * @returns (EngineConfig | undefined) Selected engine when capacity exists.
 */
const selectEngine = (
  engines: readonly EngineConfig[],
  states: ReadonlyMap<string, EngineRuntimeState>,
  model: string,
  nowEpochMs: number,
): EngineConfig | undefined =>
  engines
    .filter((engine: EngineConfig): boolean => {
      const state: EngineRuntimeState | undefined = states.get(engine.id);
      return (
        state !== undefined &&
        engine.models.includes(model) &&
        state.running < engine.maxConcurrent &&
        state.openUntilEpochMs <= nowEpochMs
      );
    })
    .toSorted((left: EngineConfig, right: EngineConfig): number => {
      const leftState: EngineRuntimeState | undefined = states.get(left.id);
      const rightState: EngineRuntimeState | undefined = states.get(right.id);
      const leftLoad: number =
        (leftState?.running ?? left.maxConcurrent) / left.maxConcurrent;
      const rightLoad: number =
        (rightState?.running ?? right.maxConcurrent) / right.maxConcurrent;
      return leftLoad === rightLoad
        ? left.id.localeCompare(right.id)
        : leftLoad - rightLoad;
    })[0];

/**
 * Converts scheduler state to public low-cardinality engine views.
 *
 * @param config - (PlatformConfig) Runtime configuration.
 * @param states - (ReadonlyMap<string, EngineRuntimeState>) Scheduler state.
 * @returns (readonly EngineView[]) Public engine views.
 */
const toEngineViews = (
  config: PlatformConfig,
  states: ReadonlyMap<string, EngineRuntimeState>,
): readonly EngineView[] =>
  config.engines.map((engine: EngineConfig): EngineView => {
    const state: EngineRuntimeState | undefined = states.get(engine.id);
    return {
      backend: engine.backend,
      health: state?.health ?? ENGINE_HEALTH.OFFLINE,
      id: engine.id,
      maxConcurrent: engine.maxConcurrent,
      models: engine.models,
      provider: engine.provider,
      running: state?.running ?? ENGINE_NUMERIC.ZERO_RUNNING,
    };
  });

/**
 * Applies one successful engine probe or request to scheduler state.
 *
 * @param states - (ReadonlyMap<string, EngineRuntimeState>) Current state.
 * @param engineId - (string) Engine identifier.
 * @returns (ReadonlyMap<string, EngineRuntimeState>) Updated immutable state.
 */
const recordEngineSuccess = (
  states: ReadonlyMap<string, EngineRuntimeState>,
  engineId: string,
): ReadonlyMap<string, EngineRuntimeState> => {
  const current: EngineRuntimeState | undefined = states.get(engineId);
  if (current === undefined) return states;
  const next: Map<string, EngineRuntimeState> = new Map(states);
  next.set(engineId, {
    ...current,
    consecutiveFailures: 0,
    health: ENGINE_HEALTH.HEALTHY,
    openUntilEpochMs: 0,
  });
  return next;
};

/**
 * Releases one capacity reservation without allowing a negative counter.
 *
 * @param states - (ReadonlyMap<string, EngineRuntimeState>) Current state.
 * @param engineId - (string) Engine identifier.
 * @returns (ReadonlyMap<string, EngineRuntimeState>) Updated immutable state.
 */
const releaseEngineReservation = (
  states: ReadonlyMap<string, EngineRuntimeState>,
  engineId: string,
): ReadonlyMap<string, EngineRuntimeState> => {
  const current: EngineRuntimeState | undefined = states.get(engineId);
  if (current === undefined) return states;
  const next: Map<string, EngineRuntimeState> = new Map(states);
  next.set(engineId, {
    ...current,
    running: Math.max(ENGINE_NUMERIC.ZERO_RUNNING, current.running - 1),
  });
  return next;
};

/**
 * Applies one upstream failure and opens the circuit when its threshold is met.
 *
 * @param config - (PlatformConfig) Runtime engine configuration.
 * @param states - (ReadonlyMap<string, EngineRuntimeState>) Current state.
 * @param engineId - (string) Engine identifier.
 * @param nowEpochMs - (number) Current Effect clock time.
 * @returns (ReadonlyMap<string, EngineRuntimeState>) Updated immutable state.
 */
const recordEngineFailure = (
  config: PlatformConfig,
  states: ReadonlyMap<string, EngineRuntimeState>,
  engineId: string,
  nowEpochMs: number,
): ReadonlyMap<string, EngineRuntimeState> => {
  const current: EngineRuntimeState | undefined = states.get(engineId);
  const engine: EngineConfig | undefined = config.engines.find(
    (candidate: EngineConfig): boolean => candidate.id === engineId,
  );
  if (current === undefined || engine === undefined) return states;
  const failures: number = current.consecutiveFailures + 1;
  const circuitOpen: boolean =
    failures >= engine.circuitBreaker.failureThreshold;
  const next: Map<string, EngineRuntimeState> = new Map(states);
  next.set(engineId, {
    ...current,
    consecutiveFailures: failures,
    health: circuitOpen ? ENGINE_HEALTH.OFFLINE : ENGINE_HEALTH.DEGRADED,
    openUntilEpochMs: circuitOpen
      ? nowEpochMs +
        engine.circuitBreaker.cooldownSeconds *
          MILLISECONDS_PER_SECOND
      : current.openUntilEpochMs,
  });
  return next;
};

/**
 * Atomically chooses and reserves one engine slot.
 *
 * @param config - (PlatformConfig) Runtime engine configuration.
 * @param states - (ReadonlyMap<string, EngineRuntimeState>) Current state.
 * @param model - (string) Requested model alias.
 * @param nowEpochMs - (number) Current Effect clock time.
 * @returns (EngineReservationState) Reservation plus updated state.
 */
const reserveEngine = (
  config: PlatformConfig,
  states: ReadonlyMap<string, EngineRuntimeState>,
  model: string,
  nowEpochMs: number,
): EngineReservationState => {
  const selected: EngineConfig | undefined = selectEngine(
    config.engines,
    states,
    model,
    nowEpochMs,
  );
  if (selected === undefined) return [Option.none(), states];
  const current: EngineRuntimeState | undefined = states.get(selected.id);
  if (current === undefined) return [Option.none(), states];
  const next: Map<string, EngineRuntimeState> = new Map(states);
  next.set(selected.id, { ...current, running: current.running + 1 });
  return [Option.some({ engine: selected }), next];
};

/**
 * Atomically reserves a specific compatible engine, primarily for restart recovery.
 *
 * @param config - (PlatformConfig) Runtime engine configuration.
 * @param states - (ReadonlyMap<string, EngineRuntimeState>) Current state.
 * @param engineId - (string) Required engine identifier.
 * @param model - (string) Requested model alias.
 * @param nowEpochMs - (number) Current Effect clock time.
 * @returns (EngineReservationState) Reservation plus updated state.
 */
const reserveEngineById = (
  config: PlatformConfig,
  states: ReadonlyMap<string, EngineRuntimeState>,
  engineId: string,
  model: string,
  nowEpochMs: number,
): EngineReservationState => {
  const engine: EngineConfig | undefined = config.engines.find(
    (candidate: EngineConfig): boolean => candidate.id === engineId,
  );
  const state: EngineRuntimeState | undefined = states.get(engineId);
  const reservable: boolean =
    engine !== undefined &&
    state !== undefined &&
    engine.models.includes(model) &&
    state.running < engine.maxConcurrent &&
    state.openUntilEpochMs <= nowEpochMs;
  if (!reservable || engine === undefined || state === undefined) {
    return [Option.none(), states];
  }
  const next: Map<string, EngineRuntimeState> = new Map(states);
  next.set(engineId, { ...state, running: state.running + 1 });
  return [Option.some({ engine }), next];
};

export type { EngineReservationState };
export {
  createInitialEngineState,
  recordEngineFailure,
  recordEngineSuccess,
  releaseEngineReservation,
  reserveEngine,
  reserveEngineById,
  selectEngine,
  toEngineViews,
};
