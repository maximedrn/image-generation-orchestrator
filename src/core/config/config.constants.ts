/** Environment variables read directly by the configuration loader. */
const ConfigEnvironment = {
  apiKey: "PLATFORM_API_KEY",
  configPath: "PLATFORM_CONFIG",
  engineBackend: "ENGINE_BACKEND",
  engineUrl: "ENGINE_URL",
  modelDirectory: "MODEL_DIRECTORY",
  port: "PLATFORM_PORT",
} as const;

/** Fallback values applied when the environment does not override the file. */
const ConfigDefaults = {
  modelDirectory: "./config/models",
  path: "config/platform.yaml",
} as const;

/** Cross-field invariants that the structural schema cannot express. */
const ConfigInvariants = {
  minimumEngineCount: 1,
} as const;

/**
 * Schema-level configuration bounds protecting accidental pathological values.
 */
const ConfigSchemaLimits = {
  bodyBytesMax: 64 * 1024 * 1024,
  bodyBytesMin: 1024,
  circuitBreakerFailuresMax: 100,
  circuitBreakerFailuresMin: 1,
  cooldownSecondsMax: 3600,
  cooldownSecondsMin: 1,
  engineConcurrencyMax: 64,
  engineConcurrencyMin: 1,
  httpPortMax: 65_535,
  httpPortMin: 1,
  leaseSecondsMax: 3600,
  leaseSecondsMin: 5,
  pollIntervalMsMax: 60_000,
  pollIntervalMsMin: 50,
  queueSizeMax: 1_000_000,
  queueSizeMin: 1,
  rateLimitMax: 1_000_000,
  rateLimitMin: 1,
  recoveryIntervalSecondsMax: 3600,
  recoveryIntervalSecondsMin: 1,
  retryAttemptsMax: 100,
  retryAttemptsMin: 1,
  timeoutSecondsMax: 3600,
  timeoutSecondsMin: 1,
  windowSecondsMax: 3600,
  windowSecondsMin: 1,
} as const;

/** Supported HTTP protocols for configured inference-engine endpoints. */
const EngineUrlProtocol = {
  http: "http:",
  https: "https:",
} as const;

/** Engine provider identifiers understood by this release. */
const EngineProvider = {
  stableDiffusionCpp: "stable-diffusion-cpp",
} as const;

/** Hardware backend identifiers exposed for observability and scheduling. */
const EngineBackend = {
  cpu: "cpu",
  cuda: "cuda",
  metal: "metal",
  rocm: "rocm",
  vulkan: "vulkan",
} as const;

/** Authentication modes supported by the HTTP adapter. */
const AuthMode = {
  bearer: "bearer",
  none: "none",
} as const;

/** Operator-facing configuration failure messages. */
const ConfigMessage = {
  duplicateEngineId: "duplicate engine id",
  engineNotAssigned: "model is not assigned to any engine",
  invalidEngineUrl: "engine has an invalid absolute URL",
  invalidYaml: "invalid YAML in configuration file",
  missingApiKey: `environment variable ${ConfigEnvironment.apiKey} is missing or empty`,
  noEngine: "at least one inference engine is required",
  unreadableFile: "cannot read configuration file",
  unsupportedProtocol: "unsupported protocol for engine",
  validationFailed: "invalid configuration",
} as const;

/** Syntax the Effect config provider uses to read the environment. */
const EnvironmentSyntax = {
  pathDelimiter: "__",
  urlPathSeparator: "/",
} as const;

/** Environment prefixes declaring model artefacts and their digests. */
const ModelEnvironmentPrefix = {
  digest: "MODEL_SHA256",
  url: "MODEL",
} as const;

export {
  AuthMode,
  ConfigDefaults,
  ConfigEnvironment,
  ConfigInvariants,
  ConfigMessage,
  ConfigSchemaLimits,
  EngineBackend,
  EngineProvider,
  EngineUrlProtocol,
  EnvironmentSyntax,
  ModelEnvironmentPrefix,
};
