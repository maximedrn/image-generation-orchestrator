import { HttpRoute } from "@app/core/http/http.constants";
import { HttpEffectService } from "@app/core/http/http-effect.service";
import { BearerAuthGuard } from "@app/core/security/bearer-auth.guard";
import type { EnginePoolShape } from "@app/infrastructure/engine/engine.interface";
import type { EngineView } from "@app/infrastructure/engine/engine.types";
import { EnginePool } from "@app/infrastructure/engine/pool/engine-pool.service";
import { Controller, Get, UseGuards } from "@nestjs/common";
import { Effect } from "effect";

/** Protected engine-registry HTTP adapter. */
@Controller(HttpRoute.engineCollection)
@UseGuards(BearerAuthGuard)
class EngineController {
  readonly #httpEffect: HttpEffectService;

  /**
   * Creates the engine HTTP adapter.
   *
   * @param {HttpEffectService} httpEffect - Typed Effect/HTTP bridge.
   */
  constructor(httpEffect: HttpEffectService) {
    this.#httpEffect = httpEffect;
  }

  /**
   * Lists scheduler-visible engine states without secrets or prompts.
   *
   * @returns {Promise<readonly EngineView[]>} Engine state list.
   */
  @Get()
  list(): Promise<readonly EngineView[]> {
    return this.#httpEffect.run(
      Effect.flatMap(
        EnginePool,
        (pool: EnginePoolShape): Effect.Effect<readonly EngineView[]> =>
          pool.list(),
      ),
    );
  }
}

export { EngineController };
