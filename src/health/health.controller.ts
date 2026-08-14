import { Controller, Get } from "@nestjs/common";
import { Effect } from "effect";

import { ConfigService } from "@app/config/config.service.js";
import type { PlatformConfig } from "@app/config/config.types.js";
import { EnginePool } from "@app/engine/engine-pool.service.js";
import type {
  EngineGatewayShape,
  EnginePoolShape,
} from "@app/engine/engine.interface.js";
import { EngineGateway } from "@app/engine/engine.service.js";
import type { JobRepositoryShape } from "@app/job/job-repository.interface.js";
import { JobRepository } from "@app/job/job-repository.service.js";
import { EngineUnavailableError } from "@app/error/error.types.js";
import { countReadyEngines } from "@app/health/health.helpers.js";
import { HTTP_ROUTE } from "@app/http/http.constants.js";
import { HttpEffectService } from "@app/http/http-effect.service.js";
import type {
  HealthLiveResponse,
  HealthReadyResponse,
} from "@app/http/http.types.js";

/** Unauthenticated Kubernetes/Docker liveness and readiness endpoints. */
@Controller()
class HealthController {
  readonly #httpEffect: HttpEffectService;

  /**
   * Creates the health HTTP adapter.
   *
   * @param httpEffect - (HttpEffectService) Typed Effect/HTTP bridge.
   */
  constructor(httpEffect: HttpEffectService) {
    this.#httpEffect = httpEffect;
  }

  /**
   * Reports process liveness without touching external dependencies.
   *
   * @returns (HealthLiveResponse) Immediate process status.
   */
  @Get(HTTP_ROUTE.HEALTH_LIVE)
  live(): HealthLiveResponse {
    return { status: "live" };
  }

  /**
   * Reports readiness after probing durable storage and configured engines.
   *
   * @returns (Promise<HealthReadyResponse>) Ready dependency summary.
   */
  @Get(HTTP_ROUTE.HEALTH_READY)
  ready(): Promise<HealthReadyResponse> {
    return this.#httpEffect.run(
      Effect.gen(function* readinessEffect(): Generator<
        unknown,
        HealthReadyResponse
      > {
        const config: PlatformConfig = yield* ConfigService;
        const repository: JobRepositoryShape = yield* JobRepository;
        const gateway: EngineGatewayShape = yield* EngineGateway;
        const pool: EnginePoolShape = yield* EnginePool;
        yield* repository.ping();
        const enginesAvailable: number = yield* countReadyEngines(
          config.engines,
          gateway,
          pool,
        );
        if (enginesAvailable === 0) {
          return yield* Effect.fail(
            new EngineUnavailableError({
              message: "no inference engine supports image generation",
            }),
          );
        }
        return { enginesAvailable, status: "ready" };
      }),
    );
  }
}

export { HealthController };
