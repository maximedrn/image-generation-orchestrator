import { Context, Effect, Layer, Ref } from "effect";

import { EFFECT_SERVICE_IDENTIFIER } from "@app/runtime/runtime.constants.js";
import { ConfigService } from "@app/config/config.service.js";
import type { PlatformConfig } from "@app/config/config.types.js";
import { createEnginePool } from "@app/engine/engine-pool.factory.js";
import { createInitialEngineState, selectEngine } from "@app/engine/engine-pool.helpers.js";
import type { EnginePoolShape } from "@app/engine/engine.interface.js";
import type { EngineRuntimeState } from "@app/engine/engine.types.js";

/** Effect Context tag for least-loaded engine scheduling and circuit breaking. */
class EnginePool extends Context.Tag(EFFECT_SERVICE_IDENTIFIER.ENGINE_POOL)<
  EnginePool,
  EnginePoolShape
>() {}

/** Live least-loaded engine pool layer. */
const EnginePoolLive: Layer.Layer<EnginePool, never, ConfigService> =
  Layer.effect(
    EnginePool,
    Effect.gen(
      function* enginePoolLayerEffect(): Generator<unknown, EnginePoolShape> {
        const config: PlatformConfig = yield* ConfigService;
        const stateRef: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>> =
          yield* Ref.make(createInitialEngineState(config.engines));
        return createEnginePool(config, stateRef);
      },
    ),
  );

export {
  createEnginePool,
  createInitialEngineState as createInitialState,
  EnginePool,
  EnginePoolLive,
  selectEngine,
};
