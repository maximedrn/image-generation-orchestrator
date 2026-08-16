import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import {
  EngineHealth,
  EngineNumeric,
} from "@app/infrastructure/engine/engine.constants";
import type {
  EngineReservation,
  EngineRuntimeState,
  EngineView,
} from "@app/infrastructure/engine/engine.types";
import { Duration, Option } from "effect";

/** Atomic state/result pair returned by an engine reservation attempt. */
type EngineReservationState = readonly [
  Option.Option<EngineReservation>,
  ReadonlyMap<string, EngineRuntimeState>,
];

/**
 * Creates initial scheduler state for every configured engine.
 *
 * @param {readonly EngineConfig[]} engines - Configured engine instances.
 * @returns {ReadonlyMap<string, EngineRuntimeState>} Initial state map.
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
          health: EngineHealth.healthy,
          openUntilEpochMs: 0,
          running: EngineNumeric.zeroRunning,
        },
      ],
    ),
  );

/**
 * Selects the least-loaded compatible engine with an available slot.
 *
 * @param {readonly EngineConfig[]} engines - Configured engines.
 * @param {ReadonlyMap<string, EngineRuntimeState>} states - Runtime states.
 * @param {string} model - Requested public model alias.
 * @param {number} nowEpochMs - Current clock time.
 * @returns {EngineConfig | undefined} Selected engine when capacity exists.
 */
const selectEngine = (
  engines: readonly EngineConfig[],
  states: ReadonlyMap<string, EngineRuntimeState>,
  model: string,
  nowEpochMs: number,
): EngineConfig | undefined =>
  engines
    .filter((engine: EngineConfig): boolean => {
      const stateOption: Option.Option<EngineRuntimeState> =
        Option.fromNullable(states.get(engine.id));
      return Option.match(stateOption, {
        onNone: (): boolean => false,
        onSome: (state: EngineRuntimeState): boolean =>
          engine.models.includes(model) &&
          state.running < engine.maxConcurrent &&
          state.openUntilEpochMs <= nowEpochMs,
      });
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
 * @param {PlatformConfig} config - Runtime configuration.
 * @param {ReadonlyMap<string, EngineRuntimeState>} states - Scheduler state.
 * @returns {readonly EngineView[]} Public engine views.
 */
const toEngineViews = (
  config: PlatformConfig,
  states: ReadonlyMap<string, EngineRuntimeState>,
): readonly EngineView[] =>
  config.engines.map((engine: EngineConfig): EngineView => {
    const state: EngineRuntimeState | undefined = states.get(engine.id);
    return {
      backend: engine.backend,
      health: state?.health ?? EngineHealth.offline,
      id: engine.id,
      maxConcurrent: engine.maxConcurrent,
      models: engine.models,
      provider: engine.provider,
      running: state?.running ?? EngineNumeric.zeroRunning,
    };
  });

/**
 * Applies one successful engine probe or request to scheduler state.
 *
 * @param {ReadonlyMap<string, EngineRuntimeState>} states - Current state.
 * @param {string} engineId - Engine identifier.
 * @returns {ReadonlyMap<string, EngineRuntimeState>} Updated immutable state.
 */
const recordEngineSuccess = (
  states: ReadonlyMap<string, EngineRuntimeState>,
  engineId: string,
): ReadonlyMap<string, EngineRuntimeState> => {
  const currentOption: Option.Option<EngineRuntimeState> = Option.fromNullable(
    states.get(engineId),
  );
  if (Option.isNone(currentOption)) return states;
  const current: EngineRuntimeState = currentOption.value;
  const next: Map<string, EngineRuntimeState> = new Map(states);
  next.set(engineId, {
    ...current,
    consecutiveFailures: 0,
    health: EngineHealth.healthy,
    openUntilEpochMs: 0,
  });
  return next;
};

/**
 * Releases one capacity reservation without allowing a negative counter.
 *
 * @param {ReadonlyMap<string, EngineRuntimeState>} states - Current state.
 * @param {string} engineId - Engine identifier.
 * @returns {ReadonlyMap<string, EngineRuntimeState>} Updated immutable state.
 */
const releaseEngineReservation = (
  states: ReadonlyMap<string, EngineRuntimeState>,
  engineId: string,
): ReadonlyMap<string, EngineRuntimeState> => {
  const currentOption: Option.Option<EngineRuntimeState> = Option.fromNullable(
    states.get(engineId),
  );
  if (Option.isNone(currentOption)) return states;
  const current: EngineRuntimeState = currentOption.value;
  const next: Map<string, EngineRuntimeState> = new Map(states);
  next.set(engineId, {
    ...current,
    running: Math.max(EngineNumeric.zeroRunning, current.running - 1),
  });
  return next;
};

/**
 * Applies one upstream failure and opens the circuit when its threshold is met.
 *
 * @param {PlatformConfig} config - Runtime engine configuration.
 * @param {ReadonlyMap<string, EngineRuntimeState>} states - Current state.
 * @param {string} engineId - Engine identifier.
 * @param {number} nowEpochMs - Current Effect clock time.
 * @returns {ReadonlyMap<string, EngineRuntimeState>} Updated immutable state.
 */
const recordEngineFailure = (
  config: PlatformConfig,
  states: ReadonlyMap<string, EngineRuntimeState>,
  engineId: string,
  nowEpochMs: number,
): ReadonlyMap<string, EngineRuntimeState> => {
  const currentOption: Option.Option<EngineRuntimeState> = Option.fromNullable(
    states.get(engineId),
  );
  const engineOption: Option.Option<EngineConfig> = Option.fromNullable(
    config.engines.find(
      (candidate: EngineConfig): boolean => candidate.id === engineId,
    ),
  );
  if (Option.isNone(currentOption) || Option.isNone(engineOption)) {
    return states;
  }
  const current: EngineRuntimeState = currentOption.value;
  const engine: EngineConfig = engineOption.value;
  const failures: number = current.consecutiveFailures + 1;
  const circuitOpen: boolean =
    failures >= engine.circuitBreaker.failureThreshold;
  const next: Map<string, EngineRuntimeState> = new Map(states);
  next.set(engineId, {
    ...current,
    consecutiveFailures: failures,
    health: circuitOpen ? EngineHealth.offline : EngineHealth.degraded,
    openUntilEpochMs: circuitOpen
      ? nowEpochMs +
        Duration.toMillis(
          Duration.seconds(engine.circuitBreaker.cooldownSeconds),
        )
      : current.openUntilEpochMs,
  });
  return next;
};

/**
 * Atomically chooses and reserves one engine slot.
 *
 * @param {PlatformConfig} config - Runtime engine configuration.
 * @param {ReadonlyMap<string, EngineRuntimeState>} states - Current state.
 * @param {string} model - Requested model alias.
 * @param {number} nowEpochMs - Current Effect clock time.
 * @returns {EngineReservationState} Reservation plus updated state.
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
  const selectedOption: Option.Option<EngineConfig> =
    Option.fromNullable(selected);
  if (Option.isNone(selectedOption)) return [Option.none(), states];
  const currentOption: Option.Option<EngineRuntimeState> = Option.fromNullable(
    states.get(selectedOption.value.id),
  );
  if (Option.isNone(currentOption)) return [Option.none(), states];
  const next: Map<string, EngineRuntimeState> = new Map(states);
  next.set(selectedOption.value.id, {
    ...currentOption.value,
    running: currentOption.value.running + 1,
  });
  return [Option.some({ engine: selectedOption.value }), next];
};

/**
 * Atomically reserves a specific compatible engine, primarily for restart recovery.
 *
 * @param {PlatformConfig} config - Runtime engine configuration.
 * @param {ReadonlyMap<string, EngineRuntimeState>} states - Current state.
 * @param {string} engineId - Required engine identifier.
 * @param {string} model - Requested model alias.
 * @param {number} nowEpochMs - Current Effect clock time.
 * @returns {EngineReservationState} Reservation plus updated state.
 */
const reserveEngineById = (
  config: PlatformConfig,
  states: ReadonlyMap<string, EngineRuntimeState>,
  engineId: string,
  model: string,
  nowEpochMs: number,
): EngineReservationState => {
  const engineOption: Option.Option<EngineConfig> = Option.fromNullable(
    config.engines.find(
      (candidate: EngineConfig): boolean => candidate.id === engineId,
    ),
  );
  const stateOption: Option.Option<EngineRuntimeState> = Option.fromNullable(
    states.get(engineId),
  );
  if (Option.isNone(engineOption) || Option.isNone(stateOption)) {
    return [Option.none(), states];
  }
  const engine: EngineConfig = engineOption.value;
  const state: EngineRuntimeState = stateOption.value;
  if (
    !engine.models.includes(model) ||
    state.running >= engine.maxConcurrent ||
    state.openUntilEpochMs > nowEpochMs
  ) {
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
