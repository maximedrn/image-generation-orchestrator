/** Public HTTP routes centralized to avoid duplicated protocol strings. */
const HTTP_ROUTE = {
  ENGINE_COLLECTION: "v1/engines",
  HEALTH_LIVE: "health/live",
  HEALTH_READY: "health/ready",
  JOB_COLLECTION: "v1/jobs",
  JOB_ID: ":id",
  METRICS: "v1/metrics",
  RESULT: ":id/results/:index",
} as const;

/** Public stable error codes independent of internal Effect tags. */
const HTTP_ERROR_CODE = {
  CONFIGURATION: "CONFIGURATION_ERROR",
  DATABASE_UNAVAILABLE: "DATABASE_UNAVAILABLE",
  ENGINE_PROTOCOL: "ENGINE_PROTOCOL_ERROR",
  ENGINE_REJECTED: "ENGINE_REJECTED",
  ENGINE_UNAVAILABLE: "ENGINE_UNAVAILABLE",
  INTERNAL: "INTERNAL_ERROR",
  INVALID_REQUEST: "INVALID_REQUEST",
  JOB_NOT_CANCELLABLE: "JOB_NOT_CANCELLABLE",
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  LIMIT_EXCEEDED: "LIMIT_EXCEEDED",
  QUEUE_FULL: "QUEUE_FULL",
  RATE_LIMITED: "RATE_LIMITED",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  UNAUTHORIZED: "UNAUTHORIZED",
} as const;

/** Safe public error messages centralized independently from internal causes. */
const HTTP_ERROR_MESSAGE = {
  CONFIGURATION: "platform configuration is unavailable",
  DATABASE_UNAVAILABLE: "durable storage is unavailable",
  ENGINE_PROTOCOL: "inference engine returned an incompatible response",
  ENGINE_REJECTED: "inference engine rejected the request",
  ENGINE_UNAVAILABLE: "no compatible inference engine is currently available",
  INTERNAL: "an unexpected platform error occurred",
  JOB_NOT_FOUND: "job or result not found",
  STORAGE_UNAVAILABLE: "result storage is unavailable",
  UNAUTHORIZED: "authentication required",
} as const;

/** HTTP response header names emitted explicitly by platform adapters. */
const HTTP_HEADER = {
  CACHE_CONTROL: "cache-control",
  CONTENT_LENGTH: "content-length",
  ETAG: "etag",
  RETRY_AFTER: "retry-after",
} as const;

/** HTTP route parameter names shared by Nest decorators and parsers. */
const HTTP_PARAMETER = {
  JOB_ID: "id",
  RESULT_INDEX: "index",
} as const;

/** Bounded Fastify listener timeouts for the asynchronous control-plane API. */
const HTTP_SERVER_TIMEOUT = {
  CONNECTION_MS: 10_000,
  KEEP_ALIVE_MS: 72_000,
  REQUEST_MS: 30_000,
} as const;

/** Structured application logging defaults. */
const HTTP_LOG = {
  LEVEL: "info",
  REDACTION_CENSOR: "[REDACTED]",
  REDACTION_PATHS: [
    "req.headers.authorization",
    "req.headers.cookie",
    "request.headers.authorization",
    "request.headers.cookie",
  ],
} as const;

/** Immutable cache directives for generated result files. */
const RESULT_CACHE_CONTROL = "private, max-age=31536000, immutable";

export {
  HTTP_ERROR_CODE,
  HTTP_ERROR_MESSAGE,
  HTTP_HEADER,
  HTTP_LOG,
  HTTP_PARAMETER,
  HTTP_ROUTE,
  HTTP_SERVER_TIMEOUT,
  RESULT_CACHE_CONTROL,
};
