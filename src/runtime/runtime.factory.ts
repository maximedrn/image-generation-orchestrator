import { BunFileSystem } from "@effect/platform-bun";
import type { FileSystem } from "@effect/platform/FileSystem";
import { Layer, ManagedRuntime } from "effect";

import { ConfigService } from "@app/config/config.service.js";
import type { PlatformConfig } from "@app/config/config.types.js";
import { DatabaseService, DatabaseServiceLive } from "@app/database/database.service.js";
import { DispatcherLive } from "@app/dispatcher/dispatcher.service.js";
import type { Dispatcher } from "@app/dispatcher/dispatcher.service.js";
import { EnginePoolLive } from "@app/engine/engine-pool.service.js";
import { EngineGatewayLive } from "@app/engine/engine.service.js";
import type { DatabaseError, StorageError } from "@app/error/error.types.js";
import { JobRepositoryLive } from "@app/job/job-repository.service.js";
import type { JobRepository } from "@app/job/job-repository.service.js";
import { JobServiceLive } from "@app/job/job.service.js";
import type { JobService } from "@app/job/job.service.js";
import { RateLimiterLive } from "@app/rate-limit/rate-limit.service.js";
import type {
  AppContext,
  AppRuntime,
  RuntimeAdapterLayers,
  RuntimeApplicationLayers,
  RuntimeInfrastructureLayers,
} from "@app/runtime/runtime.types.js";
import { SecurityServiceLive } from "@app/security/security.service.js";
import { ResultStorageLive } from "@app/storage/storage.service.js";
import type { ResultStorage } from "@app/storage/storage.service.js";

/**
 * Builds fully-provided infrastructure layers from configuration and overrides.
 *
 * @param config - (PlatformConfig) Immutable startup configuration.
 * @param adapters - (RuntimeAdapterLayers) Optional replacement infrastructure.
 * @returns (RuntimeInfrastructureLayers) Infrastructure layer set.
 */
const createInfrastructureLayers = (
  config: PlatformConfig,
  adapters: RuntimeAdapterLayers,
): RuntimeInfrastructureLayers => {
  const configLayer: Layer.Layer<ConfigService> = Layer.succeed(ConfigService, config);
  const configAndFileSystem: Layer.Layer<ConfigService | FileSystem> = Layer.merge(
    configLayer,
    BunFileSystem.layer,
  );
  const databaseLayer: Layer.Layer<DatabaseService, DatabaseError> = Layer.provide(
    DatabaseServiceLive,
    configAndFileSystem,
  );
  const defaultRepository: Layer.Layer<JobRepository, DatabaseError> = Layer.provide(
    JobRepositoryLive,
    databaseLayer,
  );
  const defaultStorage: Layer.Layer<ResultStorage> = Layer.provide(
    ResultStorageLive,
    configAndFileSystem,
  );
  return {
    config: configLayer,
    engineGateway: adapters.engineGateway ?? EngineGatewayLive,
    enginePool: Layer.provide(EnginePoolLive, configLayer),
    jobRepository: adapters.jobRepository ?? defaultRepository,
    rateLimiter: Layer.provide(RateLimiterLive, configLayer),
    resultStorage: adapters.resultStorage ?? defaultStorage,
    security: Layer.provide(SecurityServiceLive, configLayer),
  };
};

/**
 * Builds domain orchestration layers from fully-provided infrastructure ports.
 *
 * @param infrastructure - (RuntimeInfrastructureLayers) Infrastructure dependencies.
 * @returns (RuntimeApplicationLayers) Domain service layers.
 */
const createApplicationLayers = (
  infrastructure: RuntimeInfrastructureLayers,
): RuntimeApplicationLayers => {
  const jobService: Layer.Layer<JobService, DatabaseError> = Layer.provide(
    JobServiceLive,
    Layer.mergeAll(
      infrastructure.config,
      infrastructure.jobRepository,
      infrastructure.rateLimiter,
    ),
  );
  const dispatcher: Layer.Layer<Dispatcher, DatabaseError | StorageError> = Layer.provide(
    DispatcherLive,
    Layer.mergeAll(
      infrastructure.config,
      infrastructure.engineGateway,
      infrastructure.enginePool,
      infrastructure.jobRepository,
      infrastructure.resultStorage,
    ),
  );
  return { dispatcher, jobService };
};

/**
 * Creates the complete Effect layer graph from validated configuration.
 *
 * @param config - (PlatformConfig) Immutable startup configuration.
 * @param adapters - (RuntimeAdapterLayers) Optional replacement infrastructure.
 * @returns (Layer.Layer<AppContext>) Fully provided application layer.
 */
const createAppLayer = (
  config: PlatformConfig,
  adapters: RuntimeAdapterLayers = {},
): Layer.Layer<AppContext> => {
  const infrastructure: RuntimeInfrastructureLayers = createInfrastructureLayers(
    config,
    adapters,
  );
  const application: RuntimeApplicationLayers = createApplicationLayers(infrastructure);
  const rawLayer: Layer.Layer<AppContext, DatabaseError | StorageError> = Layer.mergeAll(
    infrastructure.config,
    infrastructure.jobRepository,
    infrastructure.rateLimiter,
    infrastructure.security,
    infrastructure.engineGateway,
    infrastructure.enginePool,
    infrastructure.resultStorage,
    application.jobService,
    application.dispatcher,
  );
  return Layer.orDie(rawLayer);
};

/**
 * Constructs the single ManagedRuntime used for the lifetime of the process.
 *
 * @param config - (PlatformConfig) Immutable startup configuration.
 * @param adapters - (RuntimeAdapterLayers) Optional replacement infrastructure.
 * @returns (AppRuntime) Managed application runtime.
 */
const createAppRuntime = (
  config: PlatformConfig,
  adapters: RuntimeAdapterLayers = {},
): AppRuntime => ManagedRuntime.make(createAppLayer(config, adapters));

export {
  createAppLayer,
  createAppRuntime,
  createApplicationLayers,
  createInfrastructureLayers,
};
