import { HttpEffectService } from "@app/core/http/http-effect.service";
import { PublicHttpExceptionFilter } from "@app/core/http/http-exception.filter";
import { RuntimeToken } from "@app/core/runtime/runtime.constants";
import { EffectRuntimeService } from "@app/core/runtime/runtime.service";
import type { AppRuntime } from "@app/core/runtime/runtime.types";
import { BearerAuthGuard } from "@app/core/security/bearer-auth.guard";
import {
  type DynamicModule,
  Global,
  Module,
  type Provider,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

/** Global module publishing the Effect runtime bridge to every feature module. */
@Global()
@Module({})
class CoreModule {
  /**
   * Registers the already-built process-wide Effect runtime with NestJS.
   *
   * @param {AppRuntime} runtime - Managed Effect runtime for the application.
   * @returns {DynamicModule} Global core module definition.
   */
  static register(runtime: AppRuntime): DynamicModule {
    const runtimeProvider: Provider<AppRuntime> = {
      provide: RuntimeToken.effectRuntime,
      useValue: runtime,
    };
    return {
      exports: [EffectRuntimeService, HttpEffectService, BearerAuthGuard],
      module: CoreModule,
      providers: [
        runtimeProvider,
        EffectRuntimeService,
        HttpEffectService,
        BearerAuthGuard,
        { provide: APP_FILTER, useClass: PublicHttpExceptionFilter },
      ],
    };
  }
}

export { CoreModule };
