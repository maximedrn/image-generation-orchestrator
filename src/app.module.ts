import { Module, type DynamicModule, type Provider } from "@nestjs/common";

import type { AppRuntime } from "@app/runtime/runtime.types.js";
import { EFFECT_RUNTIME_TOKEN } from "@app/runtime/runtime.constants.js";
import { EngineController } from "@app/engine/engine.controller.js";
import { HealthController } from "@app/health/health.controller.js";
import { HttpEffectService } from "@app/http/http-effect.service.js";
import { MetricsController } from "@app/http/metrics.controller.js";
import { JobController } from "@app/job/job.controller.js";
import { ResultController } from "@app/job/result.controller.js";
import { EffectRuntimeService } from "@app/runtime/runtime.service.js";
import { BearerAuthGuard } from "@app/security/bearer-auth.guard.js";

/** Root NestJS module containing transport adapters only. */
@Module({})
class AppModule {
  /**
   * Registers the already-built process-wide Effect runtime with NestJS.
   *
   * @param runtime - (AppRuntime) Managed Effect runtime for the application.
   * @returns (DynamicModule) Root application module definition.
   */
  static register(runtime: AppRuntime): DynamicModule {
    const runtimeProvider: Provider<AppRuntime> = {
      provide: EFFECT_RUNTIME_TOKEN,
      useValue: runtime,
    };
    return {
      controllers: [
        EngineController,
        HealthController,
        JobController,
        MetricsController,
        ResultController,
      ],
      module: AppModule,
      providers: [
        runtimeProvider,
        EffectRuntimeService,
        HttpEffectService,
        BearerAuthGuard,
      ],
    };
  }
}

export { AppModule };
