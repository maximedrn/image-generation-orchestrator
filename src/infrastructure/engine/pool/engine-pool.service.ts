import { ConfigService } from "@app/core/config/config.service";
import type { PlatformConfig } from "@app/core/config/config.types";
import { ServiceTag } from "@app/core/runtime/service.constants";
import type { EnginePoolShape } from "@app/infrastructure/engine/engine.interface";
import type { EngineRuntimeState } from "@app/infrastructure/engine/engine.types";
import { createEnginePool } from "@app/infrastructure/engine/pool/engine-pool.factory";
import { createInitialEngineState } from "@app/infrastructure/engine/pool/engine-pool.helpers";
import { Effect, Ref } from "effect";

/** Least-loaded engine scheduling with per-engine circuit breaking. */
class EnginePool extends Effect.Service<EnginePool>()(ServiceTag.enginePool, {
  effect: ConfigService.pipe(
    Effect.flatMap(
      (config: PlatformConfig): Effect.Effect<EnginePoolShape> =>
        Ref.make(createInitialEngineState(config.engines)).pipe(
          Effect.map(
            (
              stateRef: Ref.Ref<ReadonlyMap<string, EngineRuntimeState>>,
            ): EnginePoolShape => createEnginePool(config, stateRef),
          ),
        ),
    ),
  ),
}) {}

export { EnginePool };
