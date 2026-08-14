import { Controller, Get, UseGuards } from "@nestjs/common";
import { Effect } from "effect";

import type { EnginePoolShape } from "@app/engine/engine.interface.js";
import { EnginePool } from "@app/engine/engine-pool.service.js";
import type { EngineView } from "@app/engine/engine.types.js";
import { HTTP_ROUTE } from "@app/http/http.constants.js";
import { HttpEffectService } from "@app/http/http-effect.service.js";
import type { MetricsResponse } from "@app/http/http.types.js";
import type { JobRepositoryShape } from "@app/job/job-repository.interface.js";
import { JobRepository } from "@app/job/job-repository.service.js";
import { BearerAuthGuard } from "@app/security/bearer-auth.guard.js";

/** Protected low-cardinality operational metrics endpoint. */
@Controller()
@UseGuards(BearerAuthGuard)
class MetricsController {
  readonly #httpEffect: HttpEffectService;

  /**
   * Creates the metrics HTTP adapter.
   *
   * @param httpEffect - (HttpEffectService) Typed Effect/HTTP bridge.
   */
  constructor(httpEffect: HttpEffectService) {
    this.#httpEffect = httpEffect;
  }

  /**
   * Returns bounded queue and engine metrics without user content.
   *
   * @returns (Promise<MetricsResponse>) Current operational metrics.
   */
  @Get(HTTP_ROUTE.METRICS)
  getMetrics(): Promise<MetricsResponse> {
    return this.#httpEffect.run(
      Effect.gen(function* metricsEffect(): Generator<unknown, MetricsResponse> {
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
