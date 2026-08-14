import type { Layer, ManagedRuntime } from "effect";

import type { ConfigService } from "@app/config/config.service.js";
import type { Dispatcher } from "@app/dispatcher/dispatcher.service.js";
import type { EnginePool } from "@app/engine/engine-pool.service.js";
import type { EngineGateway } from "@app/engine/engine.service.js";
import type { DatabaseError, StorageError } from "@app/error/error.types.js";
import type { JobRepository } from "@app/job/job-repository.service.js";
import type { JobService } from "@app/job/job.service.js";
import type { RateLimiter } from "@app/rate-limit/rate-limit.service.js";
import type { SecurityService } from "@app/security/security.service.js";
import type { ResultStorage } from "@app/storage/storage.service.js";

/** Union of all services exposed to application code inside the runtime. */
type AppContext =
  | ConfigService
  | Dispatcher
  | EngineGateway
  | EnginePool
  | JobRepository
  | JobService
  | RateLimiter
  | ResultStorage
  | SecurityService;

/** Optional fully-provided infrastructure layers replacing default adapters. */
interface RuntimeAdapterLayers {
  readonly engineGateway?: Layer.Layer<EngineGateway>;
  readonly jobRepository?: Layer.Layer<JobRepository, DatabaseError>;
  readonly resultStorage?: Layer.Layer<ResultStorage, StorageError>;
}

/** Fully-provided infrastructure layers used to assemble application services. */
interface RuntimeInfrastructureLayers {
  readonly config: Layer.Layer<ConfigService>;
  readonly engineGateway: Layer.Layer<EngineGateway>;
  readonly enginePool: Layer.Layer<EnginePool>;
  readonly jobRepository: Layer.Layer<JobRepository, DatabaseError>;
  readonly rateLimiter: Layer.Layer<RateLimiter>;
  readonly resultStorage: Layer.Layer<ResultStorage, StorageError>;
  readonly security: Layer.Layer<SecurityService>;
}

/** Application service layers built from infrastructure ports. */
interface RuntimeApplicationLayers {
  readonly dispatcher: Layer.Layer<Dispatcher, DatabaseError | StorageError>;
  readonly jobService: Layer.Layer<JobService, DatabaseError>;
}

/** Single application runtime type shared by every NestJS transport adapter. */
type AppRuntime = ManagedRuntime.ManagedRuntime<AppContext, never>;

export type {
  AppContext,
  AppRuntime,
  RuntimeAdapterLayers,
  RuntimeApplicationLayers,
  RuntimeInfrastructureLayers,
};
