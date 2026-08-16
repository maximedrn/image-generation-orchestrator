import { HttpRoute } from "@app/core/http/http.constants";
import type { MetricsResponse } from "@app/core/http/http.types";
import { HttpEffectService } from "@app/core/http/http-effect.service";
import { BearerAuthGuard } from "@app/core/security/bearer-auth.guard";
import { JobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import type { EnginePoolShape } from "@app/infrastructure/engine/engine.interface";
import type { EngineView } from "@app/infrastructure/engine/engine.types";
import { EnginePool } from "@app/infrastructure/engine/pool/engine-pool.service";
import type { JobRepositoryShape } from "@app/modules/jobs/job.interface";
import { Controller, Get, UseGuards } from "@nestjs/common";
import { Effect } from "effect";

/** Protected low-cardinality operational metrics endpoint. */
@Controller()
@UseGuards(BearerAuthGuard)
class MetricsController {
  readonly #httpEffect: HttpEffectService;

  /**
   * Creates the metrics HTTP adapter.
   *
   * @param {HttpEffectService} httpEffect - Typed Effect/HTTP bridge.
   */
  constructor(httpEffect: HttpEffectService) {
    this.#httpEffect = httpEffect;
  }

  /**
   * Returns bounded queue and engine metrics without user content.
   *
   * @returns {Promise<MetricsResponse>} Current operational metrics.
   */
  @Get(HttpRoute.metrics)
  getMetrics(): Promise<MetricsResponse> {
    return this.#httpEffect.run(
      Effect.gen(function* metricsEffect() {
        const repository: JobRepositoryShape = yield* JobRepository;
        const pool: EnginePoolShape = yield* EnginePool;
        const queuedJobs: number = yield* repository.countQueued();
        const engines: readonly EngineView[] = yield* pool.list();
        return { engines, queuedJobs };
      }),
    );
  }
}

export { MetricsController };
