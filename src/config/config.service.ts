import { FileSystem } from "@effect/platform/FileSystem";
import { Context, Effect, Layer, Schema } from "effect";
import { parse as parseYaml } from "yaml";

import {
  AUTH_MODE,
  CONFIG_PATH_ENVIRONMENT_VARIABLE,
  CONFIG_SCHEMA_LIMITS,
  DEFAULT_CONFIG_PATH,
  ENGINE_BACKEND,
  ENGINE_PROVIDER,
} from "@app/config/config.constants.js";
import type {
  PlatformConfig,
  SecurityConfig,
} from "@app/config/config.types.js";
import { EFFECT_SERVICE_IDENTIFIER } from "@app/runtime/runtime.constants.js";
import { ConfigError } from "@app/error/error.types.js";
import { validatePlatformConfig } from "@app/config/config.helpers.js";

const nonEmptyStringSchema: Schema.Schema<string> = Schema.NonEmptyString;
const positiveIntegerSchema: Schema.Schema<number> = Schema.PositiveInt;

const serverSchema = Schema.Struct({
  bodyLimitBytes: Schema.Int.pipe(
    Schema.between(
      CONFIG_SCHEMA_LIMITS.BODY_BYTES_MIN,
      CONFIG_SCHEMA_LIMITS.BODY_BYTES_MAX,
    ),
  ),
  host: nonEmptyStringSchema,
  port: Schema.Int.pipe(
    Schema.between(
      CONFIG_SCHEMA_LIMITS.HTTP_PORT_MIN,
      CONFIG_SCHEMA_LIMITS.HTTP_PORT_MAX,
    ),
  ),
});

const securitySchema = Schema.Struct({
  apiKeyEnv: Schema.optional(nonEmptyStringSchema),
  auth: Schema.Literal(AUTH_MODE.BEARER, AUTH_MODE.NONE),
});

const queueSchema = Schema.Struct({
  leaseSeconds: Schema.Int.pipe(
    Schema.between(
      CONFIG_SCHEMA_LIMITS.LEASE_SECONDS_MIN,
      CONFIG_SCHEMA_LIMITS.LEASE_SECONDS_MAX,
    ),
  ),
  maxAttempts: Schema.Int.pipe(
    Schema.between(
      CONFIG_SCHEMA_LIMITS.RETRY_ATTEMPTS_MIN,
      CONFIG_SCHEMA_LIMITS.RETRY_ATTEMPTS_MAX,
    ),
  ),
  maxQueuedJobs: Schema.Int.pipe(
    Schema.between(
      CONFIG_SCHEMA_LIMITS.QUEUE_SIZE_MIN,
      CONFIG_SCHEMA_LIMITS.QUEUE_SIZE_MAX,
    ),
  ),
  maxRunningJobs: positiveIntegerSchema,
  pollIntervalMs: Schema.Int.pipe(
    Schema.between(
      CONFIG_SCHEMA_LIMITS.POLL_INTERVAL_MS_MIN,
      CONFIG_SCHEMA_LIMITS.POLL_INTERVAL_MS_MAX,
    ),
  ),
  recoveryIntervalSeconds: Schema.Int.pipe(
    Schema.between(
      CONFIG_SCHEMA_LIMITS.RECOVERY_INTERVAL_SECONDS_MIN,
      CONFIG_SCHEMA_LIMITS.RECOVERY_INTERVAL_SECONDS_MAX,
    ),
  ),
});

const limitsSchema = Schema.Struct({
  maxBatch: positiveIntegerSchema,
  maxHeight: positiveIntegerSchema,
  maxInputBytes: positiveIntegerSchema,
  maxJobCost: positiveIntegerSchema,
  maxPixels: positiveIntegerSchema,
  maxSteps: positiveIntegerSchema,
  maxWidth: positiveIntegerSchema,
});

const modelSchema = Schema.Struct({
  maxHeight: positiveIntegerSchema,
  maxWidth: positiveIntegerSchema,
});

const engineSchema = Schema.Struct({
  backend: Schema.Literal(
    ENGINE_BACKEND.CPU,
    ENGINE_BACKEND.CUDA,
    ENGINE_BACKEND.METAL,
    ENGINE_BACKEND.ROCM,
    ENGINE_BACKEND.VULKAN,
  ),
  circuitBreaker: Schema.Struct({
    cooldownSeconds: Schema.Int.pipe(
      Schema.between(
        CONFIG_SCHEMA_LIMITS.COOLDOWN_SECONDS_MIN,
        CONFIG_SCHEMA_LIMITS.COOLDOWN_SECONDS_MAX,
      ),
    ),
    failureThreshold: Schema.Int.pipe(
      Schema.between(
        CONFIG_SCHEMA_LIMITS.CIRCUIT_BREAKER_FAILURES_MIN,
        CONFIG_SCHEMA_LIMITS.CIRCUIT_BREAKER_FAILURES_MAX,
      ),
    ),
  }),
  id: nonEmptyStringSchema,
  maxConcurrent: Schema.Int.pipe(
    Schema.between(
      CONFIG_SCHEMA_LIMITS.ENGINE_CONCURRENCY_MIN,
      CONFIG_SCHEMA_LIMITS.ENGINE_CONCURRENCY_MAX,
    ),
  ),
  models: Schema.Array(nonEmptyStringSchema),
  provider: Schema.Literal(ENGINE_PROVIDER.STABLE_DIFFUSION_CPP),
  requestTimeoutSeconds: Schema.Int.pipe(
    Schema.between(
      CONFIG_SCHEMA_LIMITS.TIMEOUT_SECONDS_MIN,
      CONFIG_SCHEMA_LIMITS.TIMEOUT_SECONDS_MAX,
    ),
  ),
  url: nonEmptyStringSchema,
});

const rateLimitSchema = Schema.Struct({
  maxRequests: Schema.Int.pipe(
    Schema.between(
      CONFIG_SCHEMA_LIMITS.RATE_LIMIT_MIN,
      CONFIG_SCHEMA_LIMITS.RATE_LIMIT_MAX,
    ),
  ),
  maxTrackedClients: Schema.Int.pipe(
    Schema.between(
      CONFIG_SCHEMA_LIMITS.RATE_LIMIT_MIN,
      CONFIG_SCHEMA_LIMITS.RATE_LIMIT_MAX,
    ),
  ),
  windowSeconds: Schema.Int.pipe(
    Schema.between(
      CONFIG_SCHEMA_LIMITS.WINDOW_SECONDS_MIN,
      CONFIG_SCHEMA_LIMITS.WINDOW_SECONDS_MAX,
    ),
  ),
});

const platformConfigFileSchema = Schema.Struct({
  engines: Schema.Array(engineSchema),
  limits: limitsSchema,
  models: Schema.Record({ key: nonEmptyStringSchema, value: modelSchema }),
  queue: queueSchema,
  rateLimit: rateLimitSchema,
  security: securitySchema,
  server: serverSchema,
  storage: Schema.Struct({ root: nonEmptyStringSchema }),
});

/** Structurally decoded YAML document before secret resolution. */
type PlatformConfigFile = Schema.Schema.Type<typeof platformConfigFileSchema>;

/** Effect Context tag carrying the immutable resolved configuration. */
class ConfigService extends Context.Tag(EFFECT_SERVICE_IDENTIFIER.CONFIG)<
  ConfigService,
  PlatformConfig
>() {}

/**
 * Recursively freezes decoded configuration values.
 *
 * @param value - (T) Decoded object graph.
 * @returns (T) The same object graph after recursive freezing.
 */
const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    const children: readonly unknown[] = Object.values(value);
    children.forEach((child: unknown): void => {
      deepFreeze(child);
    });
    Object.freeze(value);
  }
  return value;
};

/**
 * Resolves bearer authentication without ever interpolating arbitrary YAML.
 *
 * @param decoded - (PlatformConfigFile) Validated file content.
 * @param environment - (Readonly<Record<string, string | undefined>>) Runtime environment.
 * @param path - (string) Config path used for operator-facing errors.
 * @returns (Effect.Effect<SecurityConfig, ConfigError>) Resolved security config.
 */
const resolveSecurity = (
  decoded: PlatformConfigFile,
  environment: Readonly<Record<string, string | undefined>>,
  path: string,
): Effect.Effect<SecurityConfig, ConfigError> => {
  const apiKeyEnv: string | undefined = decoded.security.apiKeyEnv;
  if (decoded.security.auth === AUTH_MODE.NONE) {
    return Effect.succeed({ apiKey: "", auth: AUTH_MODE.NONE });
  }
  if (apiKeyEnv === undefined) {
    return Effect.fail(
      new ConfigError({
        message: `security.apiKeyEnv is required for bearer auth in ${path}`,
      }),
    );
  }
  const apiKey: string | undefined = environment[apiKeyEnv];
  if (apiKey === undefined || apiKey.length === 0) {
    return Effect.fail(
      new ConfigError({
        message: `environment variable ${apiKeyEnv} is missing or empty`,
      }),
    );
  }
  return Effect.succeed({ apiKey, apiKeyEnv, auth: AUTH_MODE.BEARER });
};

/**
 * Loads, parses, validates and freezes a YAML platform configuration.
 *
 * @param path - (string) YAML file path.
 * @param environment - (Readonly<Record<string, string | undefined>>) Secret source.
 * @returns (Effect.Effect<PlatformConfig, ConfigError, FileSystem>) Typed config effect.
 */
const loadConfig = (
  path: string,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<PlatformConfig, ConfigError, FileSystem> =>
  Effect.gen(function* loadConfigEffect(): Generator<unknown, PlatformConfig> {
    const fileSystem: FileSystem = yield* FileSystem;
    const raw: string = yield* fileSystem.readFileString(path, "utf8").pipe(
      Effect.mapError(
        (cause: unknown): ConfigError =>
          new ConfigError({ cause, message: `cannot read config file: ${path}` }),
      ),
    );
    const parsed: unknown = yield* Effect.try({
      catch: (cause: unknown): ConfigError =>
        new ConfigError({ cause, message: `invalid YAML in ${path}` }),
      try: (): unknown => parseYaml(raw),
    });
    const decoded: PlatformConfigFile = yield* Schema.decodeUnknown(
      platformConfigFileSchema,
      { onExcessProperty: "error" },
    )(parsed).pipe(
      Effect.mapError(
        (cause: unknown): ConfigError =>
          new ConfigError({ cause, message: `invalid config in ${path}` }),
      ),
    );
    const security: SecurityConfig = yield* resolveSecurity(
      decoded,
      environment,
      path,
    );
    const config: PlatformConfig = { ...decoded, security };
    yield* validatePlatformConfig(config);
    return deepFreeze(config);
  });

/** Live configuration layer backed by Bun environment and Effect FileSystem. */
const ConfigServiceLive: Layer.Layer<ConfigService, ConfigError, FileSystem> =
  Layer.effect(
    ConfigService,
    Effect.suspend((): Effect.Effect<PlatformConfig, ConfigError, FileSystem> => {
      const path: string =
        Bun.env[CONFIG_PATH_ENVIRONMENT_VARIABLE] ?? DEFAULT_CONFIG_PATH;
      return loadConfig(path, Bun.env);
    }),
  );

export { ConfigService, ConfigServiceLive, loadConfig, platformConfigFileSchema };
