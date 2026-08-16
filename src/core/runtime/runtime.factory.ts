import { ConfigService } from "@app/core/config/config.service";
import type { PlatformConfig } from "@app/core/config/config.types";
import type {
  AppContext,
  AppRuntime,
  RuntimeAdapterLayers,
} from "@app/core/runtime/runtime.types";
import { RateLimiter } from "@app/core/security/rate-limit.service";
import { SecurityService } from "@app/core/security/security.service";
import { DatabaseService } from "@app/infrastructure/database/database.service";
import { JobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import { Dispatcher } from "@app/infrastructure/dispatcher/dispatcher.service";
import { EngineGateway } from "@app/infrastructure/engine/engine.service";
import { EnginePool } from "@app/infrastructure/engine/pool/engine-pool.service";
import { ResultStorage } from "@app/infrastructure/storage/storage.service";
import { JobService } from "@app/modules/jobs/job.service";
import { FetchHttpClient, type HttpClient } from "@effect/platform";
import type { FileSystem } from "@effect/platform/FileSystem";
import { BunFileSystem } from "@effect/platform-bun";
import { Layer, ManagedRuntime } from "effect";

/** Every infrastructure port exposed to application services. */
type PortContext =
  | EngineGateway
  | EnginePool
  | JobRepository
  | RateLimiter
  | ResultStorage
  | SecurityService;

/**
 * Builds the platform layer holding configuration and the Bun/HTTP adapters.
 *
 * @param {PlatformConfig} config - Immutable startup configuration.
 * @returns {Layer.Layer<ConfigService | FileSystem | HttpClient.HttpClient>} Platform layer.
 */
const createPlatformLayer = (
  config: PlatformConfig,
): Layer.Layer<ConfigService | FileSystem | HttpClient.HttpClient> =>
  Layer.mergeAll(
    Layer.succeed(ConfigService, config),
    BunFileSystem.layer,
    FetchHttpClient.layer,
  );

/**
 * Builds every infrastructure port, honouring the optional test adapters.
 *
 * Each service declares its own dependencies through `Effect.Service`, so this
 * only has to decide which implementation backs each port.
 *
 * @param {RuntimeAdapterLayers} adapters - Optional replacement infrastructure.
 * @returns {Layer.Layer<PortContext, never, ConfigService | FileSystem | HttpClient.HttpClient>} Port layer.
 */
const createPortLayer = (
  adapters: RuntimeAdapterLayers,
): Layer.Layer<
  PortContext,
  never,
  ConfigService | FileSystem | HttpClient.HttpClient
> =>
  Layer.mergeAll(
    adapters.engineGateway ?? EngineGateway.Default,
    EnginePool.Default,
    Layer.orDie(
      adapters.jobRepository ??
        JobRepository.Default.pipe(Layer.provide(DatabaseService.Default)),
    ),
    RateLimiter.Default,
    Layer.orDie(adapters.resultStorage ?? ResultStorage.Default),
    SecurityService.Default,
  );

/**
 * Creates the complete Effect layer graph from validated configuration.
 *
 * @param {PlatformConfig} config - Immutable startup configuration.
 * @param {RuntimeAdapterLayers} adapters - Optional replacement infrastructure.
 * @returns {Layer.Layer<AppContext>} Fully provided application layer.
 */
const createAppLayer = (
  config: PlatformConfig,
  adapters: RuntimeAdapterLayers = {},
): Layer.Layer<AppContext> => {
  const configLayer: Layer.Layer<ConfigService> = Layer.succeed(
    ConfigService,
    config,
  );
  const ports: Layer.Layer<PortContext> = createPortLayer(adapters).pipe(
    Layer.provide(createPlatformLayer(config)),
  );
  const services: Layer.Layer<Dispatcher | JobService> = Layer.mergeAll(
    Dispatcher.Default,
    JobService.Default,
  ).pipe(Layer.provide(Layer.merge(configLayer, ports)));
  return Layer.mergeAll(configLayer, ports, services).pipe(Layer.orDie);
};

/**
 * Constructs the single ManagedRuntime used for the lifetime of the process.
 *
 * @param {PlatformConfig} config - Immutable startup configuration.
 * @param {RuntimeAdapterLayers} adapters - Optional replacement infrastructure.
 * @returns {AppRuntime} Managed application runtime.
 */
const createAppRuntime = (
  config: PlatformConfig,
  adapters: RuntimeAdapterLayers = {},
): AppRuntime => ManagedRuntime.make(createAppLayer(config, adapters));

export type { PortContext };
export {
  createAppLayer,
  createAppRuntime,
  createPlatformLayer,
  createPortLayer,
};
