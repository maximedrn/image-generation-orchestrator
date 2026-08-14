/** Stable Effect service identifiers used as Context tags. */
const EFFECT_SERVICE_IDENTIFIER = {
  CONFIG: "platform/ConfigService",
  DATABASE: "platform/DatabaseService",
  DISPATCHER: "platform/Dispatcher",
  ENGINE_GATEWAY: "platform/EngineGateway",
  ENGINE_POOL: "platform/EnginePool",
  JOB_REPOSITORY: "platform/JobRepository",
  JOB_SERVICE: "platform/JobService",
  RATE_LIMITER: "platform/RateLimiter",
  RESULT_STORAGE: "platform/ResultStorage",
  SECURITY: "platform/SecurityService",
} as const;

/** NestJS dependency-injection token for the single Effect ManagedRuntime. */
const EFFECT_RUNTIME_TOKEN = Symbol.for("stable-diffusion-platform/effect-runtime");

export { EFFECT_RUNTIME_TOKEN, EFFECT_SERVICE_IDENTIFIER };
