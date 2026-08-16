import {
  AuthMode,
  ConfigSchemaLimits,
  EngineBackend,
  EngineProvider,
} from "@app/core/config/config.constants";
import { Schema } from "effect";

/** Non-empty string reused by every textual configuration field. */
const NonEmptyString: Schema.Schema<string> = Schema.NonEmptyString;

/** Strictly positive integer reused by every bounded numeric field. */
const PositiveInteger: Schema.Schema<number> = Schema.Int.pipe(
  Schema.positive(),
);

/**
 * Builds a bounded integer schema from an inclusive range.
 *
 * @param {number} minimum - Smallest accepted value.
 * @param {number} maximum - Largest accepted value.
 * @returns {Schema.Schema<number>} Bounded integer schema.
 */
const boundedInteger = (
  minimum: number,
  maximum: number,
): Schema.Schema<number> => Schema.Int.pipe(Schema.between(minimum, maximum));

/** HTTP listener section of the YAML document. */
const ServerSchema = Schema.Struct({
  bodyLimitBytes: boundedInteger(
    ConfigSchemaLimits.bodyBytesMin,
    ConfigSchemaLimits.bodyBytesMax,
  ),
  host: NonEmptyString,
  port: boundedInteger(
    ConfigSchemaLimits.httpPortMin,
    ConfigSchemaLimits.httpPortMax,
  ),
  // Defaults to false: enabling it without a trusted proxy in front lets any
  // caller forge X-Forwarded-For and get a fresh rate-limit bucket per request.
  trustProxy: Schema.optionalWith(Schema.Boolean, {
    default: (): boolean => false,
  }),
});

/** Authentication section of the YAML document. */
const SecuritySchema = Schema.Struct({
  auth: Schema.Literal(AuthMode.bearer, AuthMode.none),
});

/** Durable queue and dispatcher timing section. */
const QueueSchema = Schema.Struct({
  leaseSeconds: boundedInteger(
    ConfigSchemaLimits.leaseSecondsMin,
    ConfigSchemaLimits.leaseSecondsMax,
  ),
  maxAttempts: boundedInteger(
    ConfigSchemaLimits.retryAttemptsMin,
    ConfigSchemaLimits.retryAttemptsMax,
  ),
  maxQueuedJobs: boundedInteger(
    ConfigSchemaLimits.queueSizeMin,
    ConfigSchemaLimits.queueSizeMax,
  ),
  maxRunningJobs: PositiveInteger,
  pollIntervalMs: boundedInteger(
    ConfigSchemaLimits.pollIntervalMsMin,
    ConfigSchemaLimits.pollIntervalMsMax,
  ),
  recoveryIntervalSeconds: boundedInteger(
    ConfigSchemaLimits.recoveryIntervalSecondsMin,
    ConfigSchemaLimits.recoveryIntervalSecondsMax,
  ),
});

/** Public request guardrails section. */
const LimitsSchema = Schema.Struct({
  maxBatch: PositiveInteger,
  maxHeight: PositiveInteger,
  maxInputBytes: PositiveInteger,
  maxJobCost: PositiveInteger,
  maxPixels: PositiveInteger,
  maxSteps: PositiveInteger,
  maxWidth: PositiveInteger,
});

/** Per-model safety bounds section. */
const ModelSchema = Schema.Struct({
  maxHeight: PositiveInteger,
  maxWidth: PositiveInteger,
});

/** One registered inference-engine instance. */
const EngineSchema = Schema.Struct({
  backend: Schema.Literal(
    EngineBackend.cpu,
    EngineBackend.cuda,
    EngineBackend.metal,
    EngineBackend.rocm,
    EngineBackend.vulkan,
  ),
  circuitBreaker: Schema.Struct({
    cooldownSeconds: boundedInteger(
      ConfigSchemaLimits.cooldownSecondsMin,
      ConfigSchemaLimits.cooldownSecondsMax,
    ),
    failureThreshold: boundedInteger(
      ConfigSchemaLimits.circuitBreakerFailuresMin,
      ConfigSchemaLimits.circuitBreakerFailuresMax,
    ),
  }),
  id: NonEmptyString,
  maxConcurrent: boundedInteger(
    ConfigSchemaLimits.engineConcurrencyMin,
    ConfigSchemaLimits.engineConcurrencyMax,
  ),
  models: Schema.Array(NonEmptyString),
  provider: Schema.Literal(EngineProvider.stableDiffusionCpp),
  requestTimeoutSeconds: boundedInteger(
    ConfigSchemaLimits.timeoutSecondsMin,
    ConfigSchemaLimits.timeoutSecondsMax,
  ),
  url: NonEmptyString,
});

/** Local fixed-window rate-limit section. */
const RateLimitSchema = Schema.Struct({
  maxRequests: boundedInteger(
    ConfigSchemaLimits.rateLimitMin,
    ConfigSchemaLimits.rateLimitMax,
  ),
  maxTrackedClients: boundedInteger(
    ConfigSchemaLimits.rateLimitMin,
    ConfigSchemaLimits.rateLimitMax,
  ),
  windowSeconds: boundedInteger(
    ConfigSchemaLimits.windowSecondsMin,
    ConfigSchemaLimits.windowSecondsMax,
  ),
});

/** Complete YAML document accepted by the platform. */
const PlatformConfigFileSchema = Schema.Struct({
  engines: Schema.Array(EngineSchema),
  limits: LimitsSchema,
  models: Schema.Record({ key: NonEmptyString, value: ModelSchema }),
  queue: QueueSchema,
  rateLimit: RateLimitSchema,
  security: SecuritySchema,
  server: ServerSchema,
  storage: Schema.Struct({ root: NonEmptyString }),
});

/** Structurally decoded YAML document before the environment overlay. */
type PlatformConfigFile = Schema.Schema.Type<typeof PlatformConfigFileSchema>;

export type { PlatformConfigFile };
export { PlatformConfigFileSchema };
