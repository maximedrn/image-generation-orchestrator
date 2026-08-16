import { CoreModule } from "@app/core/core.module";
import type { AppRuntime } from "@app/core/runtime/runtime.types";
import { EnginesModule } from "@app/modules/engines/engines.module";
import { HealthModule } from "@app/modules/health/health.module";
import { JobsModule } from "@app/modules/jobs/jobs.module";
import { MetricsModule } from "@app/modules/metrics/metrics.module";
import { type DynamicModule, Module } from "@nestjs/common";

/** Root module wiring the Effect runtime into the NestJS feature modules. */
@Module({})
class AppModule {
  /**
   * Builds the root module around the process-wide Effect runtime.
   *
   * @param {AppRuntime} runtime - Managed Effect runtime for the application.
   * @returns {DynamicModule} Root application module definition.
   */
  static register(runtime: AppRuntime): DynamicModule {
    return {
      imports: [
        CoreModule.register(runtime),
        EnginesModule,
        HealthModule,
        JobsModule,
        MetricsModule,
      ],
      module: AppModule,
    };
  }
}

export { AppModule };
