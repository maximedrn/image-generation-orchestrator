import { Context, Layer } from "effect";

import { EFFECT_SERVICE_IDENTIFIER } from "@app/runtime/runtime.constants.js";
import { ENGINE_PROVIDER } from "@app/config/config.constants.js";
import { createEngineGatewayRouter } from "@app/engine/engine.factory.js";
import type { EngineGatewayShape } from "@app/engine/engine.interface.js";
import { createStableDiffusionGateway } from "@app/engine/stable-diffusion.service.js";

/** Effect Context tag for the provider-agnostic inference gateway. */
class EngineGateway extends Context.Tag(EFFECT_SERVICE_IDENTIFIER.ENGINE_GATEWAY)<
  EngineGateway,
  EngineGatewayShape
>() {}

/** Live engine gateway with every provider adapter registered explicitly. */
const EngineGatewayLive: Layer.Layer<EngineGateway> = Layer.succeed(
  EngineGateway,
  createEngineGatewayRouter({
    [ENGINE_PROVIDER.STABLE_DIFFUSION_CPP]: createStableDiffusionGateway(),
  }),
);

export { EngineGateway, EngineGatewayLive };
