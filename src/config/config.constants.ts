/** Environment variable pointing at the YAML platform configuration. */
const CONFIG_PATH_ENVIRONMENT_VARIABLE = "PLATFORM_CONFIG";

/** Default configuration path used by local development and containers. */
const DEFAULT_CONFIG_PATH = "config/platform.yaml";

/** Schema-level configuration bounds protecting accidental pathological values. */
const CONFIG_SCHEMA_LIMITS = {
  BODY_BYTES_MAX: 64 * 1024 * 1024,
  BODY_BYTES_MIN: 1024,
  CIRCUIT_BREAKER_FAILURES_MAX: 100,
  CIRCUIT_BREAKER_FAILURES_MIN: 1,
  COOLDOWN_SECONDS_MAX: 3600,
  COOLDOWN_SECONDS_MIN: 1,
  ENGINE_CONCURRENCY_MAX: 64,
  ENGINE_CONCURRENCY_MIN: 1,
  HTTP_PORT_MAX: 65_535,
  HTTP_PORT_MIN: 1,
  LEASE_SECONDS_MAX: 3600,
  LEASE_SECONDS_MIN: 5,
  POLL_INTERVAL_MS_MAX: 60_000,
  POLL_INTERVAL_MS_MIN: 50,
  QUEUE_SIZE_MAX: 1_000_000,
  QUEUE_SIZE_MIN: 1,
  RECOVERY_INTERVAL_SECONDS_MAX: 3600,
  RECOVERY_INTERVAL_SECONDS_MIN: 1,
  RATE_LIMIT_MAX: 1_000_000,
  RATE_LIMIT_MIN: 1,
  RETRY_ATTEMPTS_MAX: 100,
  RETRY_ATTEMPTS_MIN: 1,
  TIMEOUT_SECONDS_MAX: 3600,
  TIMEOUT_SECONDS_MIN: 1,
  WINDOW_SECONDS_MAX: 3600,
  WINDOW_SECONDS_MIN: 1,
} as const;

/** Supported HTTP protocols for configured inference-engine endpoints. */
const ENGINE_URL_PROTOCOL = {
  HTTP: "http:",
  HTTPS: "https:",
} as const;

/** Engine provider identifiers understood by this release. */
const ENGINE_PROVIDER = {
  STABLE_DIFFUSION_CPP: "stable-diffusion-cpp",
} as const;

/** Hardware backend identifiers exposed for observability and scheduling. */
const ENGINE_BACKEND = {
  CPU: "cpu",
  CUDA: "cuda",
  METAL: "metal",
  ROCM: "rocm",
  VULKAN: "vulkan",
} as const;

/** Authentication modes supported by the HTTP adapter. */
const AUTH_MODE = {
  BEARER: "bearer",
  NONE: "none",
} as const;

export {
  AUTH_MODE,
  CONFIG_PATH_ENVIRONMENT_VARIABLE,
  CONFIG_SCHEMA_LIMITS,
  DEFAULT_CONFIG_PATH,
  ENGINE_BACKEND,
  ENGINE_PROVIDER,
  ENGINE_URL_PROTOCOL,
};
