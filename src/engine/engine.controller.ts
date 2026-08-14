import { Controller, Get, UseGuards } from "@nestjs/common";
import { Effect } from "effect";

import type { EnginePoolShape } from "@app/engine/engine.interface.js";
import { EnginePool } from "@app/engine/engine-pool.service.js";
import type { EngineView } from "@app/engine/engine.types.js";
import { HTTP_ROUTE } from "@app/http/http.constants.js";
import { HttpEffectService } from "@app/http/http-effect.service.js";
import { BearerAuthGuard } from "@app/security/bearer-auth.guard.js";

/** Protected engine-registry HTTP adapter. */
@Controller(HTTP_ROUTE.ENGINE_COLLECTION)
@UseGuards(BearerAuthGuard)
class EngineController {
  readonly #httpEffect: HttpEffectService;

  /**
   * Creates the engine HTTP adapter.
   *
   * @param httpEffect - (HttpEffectService) Typed Effect/HTTP bridge.
   */
  constructor(httpEffect: HttpEffectService) {
    this.#httpEffect = httpEffect;
  }

  /**
   * Lists scheduler-visible engine states without secrets or prompts.
   *
   * @returns (Promise<readonly EngineView[]>) Engine state list.
   */
  @Get()
  list(): Promise<readonly EngineView[]> {
    return this.#httpEffect.run(
      Effect.flatMap(EnginePool, (pool: EnginePoolShape): Effect.Effect<readonly EngineView[]> => pool.list()),
    );
  }
}

export { EngineController };
