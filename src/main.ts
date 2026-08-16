import { AppModule } from "@app/app.module";
import {
  ConfigDefaults,
  ConfigEnvironment,
} from "@app/core/config/config.constants";
import { ConfigService, loadConfig } from "@app/core/config/config.service";
import type { PlatformConfig } from "@app/core/config/config.types";
import { HttpLog, HttpServerTimeout } from "@app/core/http/http.constants";
import { ShutdownSignal } from "@app/core/runtime/runtime.constants";
import { createAppRuntime } from "@app/core/runtime/runtime.factory";
import type { AppRuntime } from "@app/core/runtime/runtime.types";
import { ModelDownloader } from "@app/infrastructure/models/model-downloader.service";
import { FetchHttpClient } from "@effect/platform";
import { BunFileSystem, BunRuntime } from "@effect/platform-bun";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Effect, Layer } from "effect";

/**
 * Builds the Fastify adapter with bounded timeouts and redacted request logs.
 *
 * @param {PlatformConfig} config - Fully validated startup configuration.
 * @returns {FastifyAdapter} Configured Fastify HTTP adapter.
 */
const createHttpAdapter = (config: PlatformConfig): FastifyAdapter =>
  new FastifyAdapter({
    bodyLimit: config.server.bodyLimitBytes,
    connectionTimeout: HttpServerTimeout.connectionMs,
    keepAliveTimeout: HttpServerTimeout.keepAliveMs,
    logger: {
      level: HttpLog.level,
      redact: {
        censor: HttpLog.redactionCensor,
        paths: [...HttpLog.redactionPaths],
      },
    },
    requestTimeout: HttpServerTimeout.requestMs,
    // Drives request.ip, which is the rate-limit key: off unless a trusted
    // proxy really sits in front, on when one does so buckets stay per-client.
    trustProxy: config.server.trustProxy,
  });

/**
 * Fetches every declared model artefact before any listener is opened.
 *
 * @param {PlatformConfig} config - Fully validated startup configuration.
 * @returns {Effect.Effect<void>} Completes once all models are present locally.
 */
const provisionModels = (config: PlatformConfig): Effect.Effect<void> =>
  ModelDownloader.pipe(
    Effect.flatMap(
      (downloader: ModelDownloader): Effect.Effect<void> =>
        downloader.sync().pipe(Effect.orDie),
    ),
    Effect.provide(
      ModelDownloader.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ConfigService, config),
            BunFileSystem.layer,
            FetchHttpClient.layer,
          ),
        ),
      ),
    ),
  );

/**
 * Boots the NestJS transport around the Effect application runtime.
 *
 * @returns {Effect.Effect<void>} Resolves once the HTTP listener accepts traffic.
 */
const bootstrap = (): Effect.Effect<void> =>
  Effect.gen(function* bootstrapEffect() {
    const config: PlatformConfig = yield* loadConfig(
      Bun.env[ConfigEnvironment.configPath] ?? ConfigDefaults.path,
      Bun.env,
    ).pipe(Effect.provide(BunFileSystem.layer), Effect.orDie);
    yield* provisionModels(config);
    const runtime: AppRuntime = createAppRuntime(config);
    const application: NestFastifyApplication = yield* Effect.promise(
      (): Promise<NestFastifyApplication> =>
        NestFactory.create<NestFastifyApplication>(
          AppModule.register(runtime),
          createHttpAdapter(config),
          { bufferLogs: false, logger: false },
        ),
    );
    application.enableShutdownHooks([
      ShutdownSignal.interrupt,
      ShutdownSignal.terminate,
    ]);
    yield* Effect.promise(
      (): Promise<unknown> =>
        application.listen(config.server.port, config.server.host),
    );
  });

// Guarded so tests can import `bootstrap` without opening a listener.
if (import.meta.main) {
  BunRuntime.runMain(bootstrap());
}

export { bootstrap, createHttpAdapter, provisionModels };
