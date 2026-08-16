import type {
  AuthMode,
  EngineBackend,
  EngineProvider,
} from "@app/core/config/config.constants";

/** HTTP listener configuration. */
interface ServerConfig {
  readonly bodyLimitBytes: number;
  readonly host: string;
  readonly port: number;
  readonly trustProxy: boolean;
}

/** Authentication configuration with the resolved secret kept in memory only. */
interface SecurityConfig {
  readonly apiKey: string;
  readonly auth: AuthModeValue;
}

/** Durable queue and dispatcher timing configuration. */
interface QueueConfig {
  readonly leaseSeconds: number;
  readonly maxAttempts: number;
  readonly maxQueuedJobs: number;
  readonly maxRunningJobs: number;
  readonly pollIntervalMs: number;
  readonly recoveryIntervalSeconds: number;
}

/** Public request guardrails. */
interface LimitsConfig {
  readonly maxBatch: number;
  readonly maxHeight: number;
  readonly maxInputBytes: number;
  readonly maxJobCost: number;
  readonly maxPixels: number;
  readonly maxSteps: number;
  readonly maxWidth: number;
}

/** One public model alias and its per-model safety bounds. */
interface ModelConfig {
  readonly maxHeight: number;
  readonly maxWidth: number;
}

/** Local result storage configuration. */
interface StorageConfig {
  readonly root: string;
}

/** Local fixed-window rate-limit configuration. */
interface RateLimitConfig {
  readonly maxRequests: number;
  readonly maxTrackedClients: number;
  readonly windowSeconds: number;
}

/** Per-engine circuit-breaker configuration. */
interface CircuitBreakerConfig {
  readonly cooldownSeconds: number;
  readonly failureThreshold: number;
}

/** One concrete inference-engine instance registered with the scheduler. */
interface EngineConfig {
  readonly backend: EngineBackendValue;
  readonly circuitBreaker: CircuitBreakerConfig;
  readonly id: string;
  readonly maxConcurrent: number;
  readonly models: readonly string[];
  readonly provider: EngineProviderValue;
  readonly requestTimeoutSeconds: number;
  readonly url: string;
}

/** One declared model artefact fetched into the local model directory. */
interface ModelDownload {
  readonly name: string;
  readonly sha256?: string;
  readonly url: string;
}

/** Local model directory and the artefacts to fetch into it. */
interface ModelsConfig {
  readonly directory: string;
  readonly downloads: readonly ModelDownload[];
}

/** Fully decoded, immutable application configuration. */
interface PlatformConfig {
  readonly engines: readonly EngineConfig[];
  readonly limits: LimitsConfig;
  readonly modelSource: ModelsConfig;
  readonly models: Readonly<Record<string, ModelConfig>>;
  readonly queue: QueueConfig;
  readonly rateLimit: RateLimitConfig;
  readonly security: SecurityConfig;
  readonly server: ServerConfig;
  readonly storage: StorageConfig;
}

/** Environment overrides applied on top of the decoded YAML document. */
interface ConfigOverlay {
  readonly apiKey: string;
  readonly engineBackend?: EngineBackendValue;
  readonly engineUrl?: string;
  readonly modelDirectory: string;
  readonly modelDownloads: readonly ModelDownload[];
  readonly port?: number;
}

/** Authentication mode literal union. */
type AuthModeValue = (typeof AuthMode)[keyof typeof AuthMode];

/** Hardware backend literal union. */
type EngineBackendValue = (typeof EngineBackend)[keyof typeof EngineBackend];

/** Engine-provider literal union. */
type EngineProviderValue = (typeof EngineProvider)[keyof typeof EngineProvider];

export type {
  AuthModeValue,
  CircuitBreakerConfig,
  ConfigOverlay,
  EngineBackendValue,
  EngineConfig,
  EngineProviderValue,
  LimitsConfig,
  ModelConfig,
  ModelDownload,
  ModelsConfig,
  PlatformConfig,
  QueueConfig,
  RateLimitConfig,
  SecurityConfig,
  ServerConfig,
  StorageConfig,
};
