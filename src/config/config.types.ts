import type { Schema } from "effect";

import type {
  AUTH_MODE,
  ENGINE_BACKEND,
  ENGINE_PROVIDER,
} from "@app/config/config.constants.js";

/** HTTP listener configuration. */
interface ServerConfig {
  readonly bodyLimitBytes: number;
  readonly host: string;
  readonly port: number;
}

/** Authentication configuration with the resolved secret kept in memory only. */
interface SecurityConfig {
  readonly apiKey: string;
  readonly apiKeyEnv?: string;
  readonly auth: AuthMode;
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
  readonly backend: EngineBackend;
  readonly circuitBreaker: CircuitBreakerConfig;
  readonly id: string;
  readonly maxConcurrent: number;
  readonly models: readonly string[];
  readonly provider: EngineProvider;
  readonly requestTimeoutSeconds: number;
  readonly url: string;
}

/** Fully decoded, immutable application configuration. */
interface PlatformConfig {
  readonly engines: readonly EngineConfig[];
  readonly limits: LimitsConfig;
  readonly models: Readonly<Record<string, ModelConfig>>;
  readonly queue: QueueConfig;
  readonly rateLimit: RateLimitConfig;
  readonly security: SecurityConfig;
  readonly server: ServerConfig;
  readonly storage: StorageConfig;
}

/** Authentication mode literal union. */
type AuthMode = (typeof AUTH_MODE)[keyof typeof AUTH_MODE];

/** Hardware backend literal union. */
type EngineBackend = (typeof ENGINE_BACKEND)[keyof typeof ENGINE_BACKEND];

/** Engine-provider literal union. */
type EngineProvider = (typeof ENGINE_PROVIDER)[keyof typeof ENGINE_PROVIDER];

/** Utility alias for a schema decoding the complete YAML document. */
type PlatformConfigSchemaType = Schema.Schema<PlatformConfig>;

export type {
  AuthMode,
  CircuitBreakerConfig,
  EngineBackend,
  EngineConfig,
  EngineProvider,
  LimitsConfig,
  ModelConfig,
  PlatformConfig,
  PlatformConfigSchemaType,
  QueueConfig,
  RateLimitConfig,
  SecurityConfig,
  ServerConfig,
  StorageConfig,
};
