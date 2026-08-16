import type { ConfigService } from "@app/core/config/config.service";
import type { DatabaseError, StorageError } from "@app/core/errors/error.types";
import type { RateLimiter } from "@app/core/security/rate-limit.service";
import type { SecurityService } from "@app/core/security/security.service";
import type { JobRepository } from "@app/infrastructure/database/repository/job-repository.service";
import type { Dispatcher } from "@app/infrastructure/dispatcher/dispatcher.service";
import type { EngineGateway } from "@app/infrastructure/engine/engine.service";
import type { EnginePool } from "@app/infrastructure/engine/pool/engine-pool.service";
import type { ResultStorage } from "@app/infrastructure/storage/storage.service";
import type { JobService } from "@app/modules/jobs/job.service";
import type { Layer, ManagedRuntime } from "effect";

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

/** Single application runtime type shared by every NestJS transport adapter. */
type AppRuntime = ManagedRuntime.ManagedRuntime<AppContext, never>;

export type { AppContext, AppRuntime, RuntimeAdapterLayers };
