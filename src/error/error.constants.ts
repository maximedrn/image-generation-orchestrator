/** Stable Effect error discriminants shared by domain and transport adapters. */
const ERROR_TAG = {
  CONFIG: "ConfigError",
  DATABASE: "DatabaseError",
  ENGINE_PROTOCOL: "EngineProtocolError",
  ENGINE_REJECTED: "EngineRejectedError",
  ENGINE_UNAVAILABLE: "EngineUnavailableError",
  INVALID_REQUEST: "InvalidRequestError",
  JOB_NOT_CANCELLABLE: "JobNotCancellableError",
  JOB_NOT_FOUND: "JobNotFoundError",
  LIMIT_EXCEEDED: "LimitExceededError",
  QUEUE_FULL: "QueueFullError",
  RATE_LIMITED: "RateLimitedError",
  STORAGE: "StorageError",
  UNAUTHORIZED: "UnauthorizedError",
} as const;

export { ERROR_TAG };
