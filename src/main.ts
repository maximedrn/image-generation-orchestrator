import { BunFileSystem } from "@effect/platform-bun";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { Effect } from "effect";

import { AppModule } from "@app/app.module.js";
import {
  CONFIG_PATH_ENVIRONMENT_VARIABLE,
  DEFAULT_CONFIG_PATH,
} from "@app/config/config.constants.js";
import { loadConfig } from "@app/config/config.service.js";
import type { PlatformConfig } from "@app/config/config.types.js";
import { PublicHttpExceptionFilter } from "@app/http/http-exception.filter.js";
import { HTTP_LOG, HTTP_SERVER_TIMEOUT } from "@app/http/http.constants.js";
import { createAppRuntime } from "@app/runtime/runtime.factory.js";
import type { AppRuntime } from "@app/runtime/runtime.types.js";

/** Default shutdown signals handled by NestJS. */
const SHUTDOWN_SIGNALS = ["SIGTERM", "SIGINT"] as const;

/**
 * Reads and validates startup configuration before any listener is opened.
 *
 * @returns (Promise<PlatformConfig>) Fully validated immutable configuration.
 */
const readStartupConfig = (): Promise<PlatformConfig> => {
  const path: string =
    Bun.env[CONFIG_PATH_ENVIRONMENT_VARIABLE] ?? DEFAULT_CONFIG_PATH;
  return Effect.runPromise(loadConfig(path, Bun.env).pipe(Effect.provide(BunFileSystem.layer)));
};

/**
 * Boots the NestJS transport around the Effect application runtime.
 *
 * @returns (Promise<void>) Resolves once the HTTP listener is accepting traffic.
 */
const bootstrap = async (): Promise<void> => {
  const config: PlatformConfig = await readStartupConfig();
  const runtime: AppRuntime = createAppRuntime(config);
  const adapter: FastifyAdapter = new FastifyAdapter({
    bodyLimit: config.server.bodyLimitBytes,
    connectionTimeout: HTTP_SERVER_TIMEOUT.CONNECTION_MS,
    keepAliveTimeout: HTTP_SERVER_TIMEOUT.KEEP_ALIVE_MS,
    logger: {
      level: HTTP_LOG.LEVEL,
      redact: {
        censor: HTTP_LOG.REDACTION_CENSOR,
        paths: [...HTTP_LOG.REDACTION_PATHS],
      },
    },
    requestTimeout: HTTP_SERVER_TIMEOUT.REQUEST_MS,
  });
  const application: NestFastifyApplication =
    await NestFactory.create<NestFastifyApplication>(
      AppModule.register(runtime),
      adapter,
      { bufferLogs: false, logger: false },
    );
  application.useGlobalFilters(new PublicHttpExceptionFilter());
  application.enableShutdownHooks([...SHUTDOWN_SIGNALS]);
  await application.listen(config.server.port, config.server.host);
};

await bootstrap();

export { bootstrap, readStartupConfig };
