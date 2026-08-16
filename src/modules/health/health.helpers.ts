import type { EngineConfig } from "@app/core/config/config.types";
import { EffectConcurrency } from "@app/core/runtime/runtime.constants";
import type {
  EngineGatewayError,
  EngineGatewayShape,
  EnginePoolShape,
} from "@app/infrastructure/engine/engine.interface";
import type { EngineCapabilities } from "@app/infrastructure/engine/engine.types";
import { Effect } from "effect";

/**
 * Probes one configured engine and updates scheduler health atomically.
 *
 * @param {EngineConfig} engine - Engine instance to probe.
 * @param {EngineGatewayShape} gateway - Concrete inference transport adapter.
 * @param {EnginePoolShape} pool - Scheduler health/capacity port.
 * @returns {Effect.Effect<boolean>} `true` when image generation is supported.
 */
const probeEngine = (
  engine: EngineConfig,
  gateway: EngineGatewayShape,
  pool: EnginePoolShape,
): Effect.Effect<boolean> =>
  gateway.capabilities(engine).pipe(
    Effect.flatMap(
      (capabilities: EngineCapabilities): Effect.Effect<boolean> => {
        const supportsImageGeneration: boolean =
          capabilities.supportsImageGeneration;
        return supportsImageGeneration
          ? pool.recordSuccess(engine.id).pipe(Effect.as(true))
          : pool.recordFailure(engine.id).pipe(Effect.as(false));
      },
    ),
    Effect.catchAll(
      (_error: EngineGatewayError): Effect.Effect<boolean> =>
        pool.recordFailure(engine.id).pipe(Effect.as(false)),
    ),
  );

/**
 * Probes all configured engines concurrently and counts usable instances.
 *
 * @param {readonly EngineConfig[]} engines - Configured engine instances.
 * @param {EngineGatewayShape} gateway - Concrete inference transport adapter.
 * @param {EnginePoolShape} pool - Scheduler health/capacity port.
 * @returns {Effect.Effect<number>} Number of engines ready for image generation.
 */
const countReadyEngines = (
  engines: readonly EngineConfig[],
  gateway: EngineGatewayShape,
  pool: EnginePoolShape,
): Effect.Effect<number> =>
  Effect.forEach(
    engines,
    (engine: EngineConfig): Effect.Effect<boolean> =>
      probeEngine(engine, gateway, pool),
    { concurrency: EffectConcurrency.unbounded },
  ).pipe(
    Effect.map(
      (results: readonly boolean[]): number =>
        results.filter((ready: boolean): boolean => ready).length,
    ),
  );

export { countReadyEngines, probeEngine };
