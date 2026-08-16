import { ConfigService } from "@app/core/config/config.service";
import type { PlatformConfig } from "@app/core/config/config.types";
import { EngineUnavailableError } from "@app/core/errors/error.types";
import { HttpRoute } from "@app/core/http/http.constants";
import type {
  HealthLiveResponse,
  HealthReadyResponse,
} from "@app/core/http/http.types";
import { HttpEffectService } from "@app/core/http/http-effect.service";
import { JobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import type {
  EngineGatewayShape,
  EnginePoolShape,
} from "@app/infrastructure/engine/engine.interface";
import { EngineGateway } from "@app/infrastructure/engine/engine.service";
import { EnginePool } from "@app/infrastructure/engine/pool/engine-pool.service";
import {
  HealthMessage,
  HealthStatus,
} from "@app/modules/health/health.constants";
import { countReadyEngines } from "@app/modules/health/health.helpers";
import type { JobRepositoryShape } from "@app/modules/jobs/job.interface";
import { Controller, Get } from "@nestjs/common";
import { Effect } from "effect";

/** Unauthenticated Kubernetes/Docker liveness and readiness endpoints. */
@Controller()
class HealthController {
  readonly #httpEffect: HttpEffectService;

  /**
   * Creates the health HTTP adapter.
   *
   * @param {HttpEffectService} httpEffect - Typed Effect/HTTP bridge.
   */
  constructor(httpEffect: HttpEffectService) {
    this.#httpEffect = httpEffect;
  }

  /**
   * Reports process liveness without touching external dependencies.
   *
   * @returns {HealthLiveResponse} Immediate process status.
   */
  @Get(HttpRoute.healthLive)
  live(): HealthLiveResponse {
    return { status: HealthStatus.live };
  }

  /**
   * Reports readiness after probing durable storage and configured engines.
   *
   * @returns {Promise<HealthReadyResponse>} Ready dependency summary.
   */
  @Get(HttpRoute.healthReady)
  ready(): Promise<HealthReadyResponse> {
    return this.#httpEffect.run(
      Effect.gen(function* readinessEffect() {
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
              message: HealthMessage.noUsableEngine,
            }),
          );
        }
        return { enginesAvailable, status: HealthStatus.ready };
      }),
    );
  }
}

export { HealthController };
