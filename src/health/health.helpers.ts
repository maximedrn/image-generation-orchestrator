import { Effect } from "effect";

import type { EngineConfig } from "@app/config/config.types.js";
import type {
  EngineGatewayError,
  EngineGatewayShape,
  EnginePoolShape,
} from "@app/engine/engine.interface.js";
import type { EngineCapabilities } from "@app/engine/engine.types.js";

/**
 * Probes one configured engine and updates scheduler health atomically.
 *
 * @param engine - (EngineConfig) Engine instance to probe.
 * @param gateway - (EngineGatewayShape) Concrete inference transport adapter.
 * @param pool - (EnginePoolShape) Scheduler health/capacity port.
 * @returns (Effect.Effect<boolean>) `true` when image generation is supported.
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
 * @param engines - (readonly EngineConfig[]) Configured engine instances.
 * @param gateway - (EngineGatewayShape) Concrete inference transport adapter.
 * @param pool - (EnginePoolShape) Scheduler health/capacity port.
 * @returns (Effect.Effect<number>) Number of engines ready for image generation.
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
    { concurrency: "unbounded" },
  ).pipe(
    Effect.map(
      (results: readonly boolean[]): number =>
        results.filter((ready: boolean): boolean => ready).length,
    ),
  );

export { countReadyEngines, probeEngine };
