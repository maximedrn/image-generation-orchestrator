import { EngineProvider } from "@app/core/config/config.constants";
import { ServiceTag } from "@app/core/runtime/service.constants";
import { createEngineGatewayRouter } from "@app/infrastructure/engine/engine.factory";
import type { EngineGatewayShape } from "@app/infrastructure/engine/engine.interface";
import { createStableDiffusionGateway } from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.service";
import { HttpClient } from "@effect/platform";
import { Effect } from "effect";

/** Provider-agnostic inference gateway with every adapter registered explicitly. */
class EngineGateway extends Effect.Service<EngineGateway>()(
  ServiceTag.engineGateway,
  {
    effect: HttpClient.HttpClient.pipe(
      Effect.map(
        (client: HttpClient.HttpClient): EngineGatewayShape =>
          createEngineGatewayRouter({
            [EngineProvider.stableDiffusionCpp]:
              createStableDiffusionGateway(client),
          }),
      ),
    ),
  },
) {}

export { EngineGateway };
