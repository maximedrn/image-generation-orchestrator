/** Separator between two path segments. */
const HttpPathSeparator: string = "/";

/** Prefix marking a path segment as a route parameter. */
const HttpParameterPrefix: string = ":";

/** HTTP route parameter names shared by Nest decorators and parsers. */
const HttpParameter = {
  jobId: "id",
  resultIndex: "index",
} as const;

/**
 * Individual path segments every public route is assembled from.
 *
 * Routes are registered by the controllers and rebuilt when a response has to
 * carry a link. Both derive from these segments so a rename cannot change the
 * routes the server answers without also changing the URLs it hands out.
 */
const HttpSegment = {
  apiVersion: "v1",
  docs: "docs",
  engines: "engines",
  health: "health",
  jobs: "jobs",
  live: "live",
  metrics: "metrics",
  openapi: "openapi.json",
  ready: "ready",
  results: "results",
} as const;

/** Public HTTP routes centralized to avoid duplicated protocol strings. */
const HttpRoute = {
  docs: `${HttpSegment.apiVersion}${HttpPathSeparator}${HttpSegment.docs}`,
  engineCollection: `${HttpSegment.apiVersion}${HttpPathSeparator}${HttpSegment.engines}`,
  healthLive: `${HttpSegment.health}${HttpPathSeparator}${HttpSegment.live}`,
  healthReady: `${HttpSegment.health}${HttpPathSeparator}${HttpSegment.ready}`,
  jobCollection: `${HttpSegment.apiVersion}${HttpPathSeparator}${HttpSegment.jobs}`,
  jobId: `${HttpParameterPrefix}${HttpParameter.jobId}`,
  metrics: `${HttpSegment.apiVersion}${HttpPathSeparator}${HttpSegment.metrics}`,
  openapi: `${HttpSegment.apiVersion}${HttpPathSeparator}${HttpSegment.openapi}`,
  result: `${HttpParameterPrefix}${HttpParameter.jobId}${HttpPathSeparator}${HttpSegment.results}${HttpPathSeparator}${HttpParameterPrefix}${HttpParameter.resultIndex}`,
} as const;

/** Public stable error codes independent of internal Effect tags. */
const HttpErrorCode = {
  configuration: "CONFIGURATION_ERROR",
  databaseUnavailable: "DATABASE_UNAVAILABLE",
  engineProtocol: "ENGINE_PROTOCOL_ERROR",
  engineRejected: "ENGINE_REJECTED",
  engineUnavailable: "ENGINE_UNAVAILABLE",
  internal: "INTERNAL_ERROR",
  invalidRequest: "INVALID_REQUEST",
  jobNotCancellable: "JOB_NOT_CANCELLABLE",
  jobNotFound: "JOB_NOT_FOUND",
  limitExceeded: "LIMIT_EXCEEDED",
  queueFull: "QUEUE_FULL",
  rateLimited: "RATE_LIMITED",
  storageUnavailable: "STORAGE_UNAVAILABLE",
  unauthorized: "UNAUTHORIZED",
} as const;

/** Safe public error messages centralized independently from internal causes. */
const HttpErrorMessage = {
  configuration: "platform configuration is unavailable",
  databaseUnavailable: "durable storage is unavailable",
  engineProtocol: "inference engine returned an incompatible response",
  engineRejected: "inference engine rejected the request",
  engineUnavailable: "no compatible inference engine is currently available",
  internal: "an unexpected platform error occurred",
  jobNotFound: "job or result not found",
  notAnInteger: "must be an integer",
  storageUnavailable: "result storage is unavailable",
  unauthorized: "authentication required",
} as const;

/** HTTP response header names emitted explicitly by platform adapters. */
const HttpHeader = {
  cacheControl: "cache-control",
  contentLength: "content-length",
  contentType: "content-type",
  etag: "etag",
  retryAfter: "retry-after",
} as const;

/** Syntax required when serialising header values. */
const HttpHeaderSyntax = {
  etagQuote: '"',
} as const;

/** Bounded Fastify listener timeouts for the asynchronous control-plane API. */
const HttpServerTimeout = {
  connectionMs: 10_000,
  keepAliveMs: 72_000,
  requestMs: 30_000,
} as const;

/** Structured application logging defaults. */
const HttpLog = {
  level: "info",
  redactionCensor: "[REDACTED]",
  redactionPaths: [
    "req.headers.authorization",
    "req.headers.cookie",
    "request.headers.authorization",
    "request.headers.cookie",
  ],
} as const;

/** Immutable cache directives for generated result files. */
const HttpCacheControl = {
  result: "private, max-age=31536000, immutable",
} as const;

export {
  HttpCacheControl,
  HttpErrorCode,
  HttpErrorMessage,
  HttpHeader,
  HttpHeaderSyntax,
  HttpLog,
  HttpParameter,
  HttpParameterPrefix,
  HttpPathSeparator,
  HttpRoute,
  HttpSegment,
  HttpServerTimeout,
};
