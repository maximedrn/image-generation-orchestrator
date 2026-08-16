/** Stable Effect error discriminants shared by domain and transport adapters. */
const ErrorTag = {
  config: "ConfigError",
  database: "DatabaseError",
  engineProtocol: "EngineProtocolError",
  engineRejected: "EngineRejectedError",
  engineUnavailable: "EngineUnavailableError",
  invalidRequest: "InvalidRequestError",
  jobNotCancellable: "JobNotCancellableError",
  jobNotFound: "JobNotFoundError",
  limitExceeded: "LimitExceededError",
  modelDownload: "ModelDownloadError",
  queueFull: "QueueFullError",
  rateLimited: "RateLimitedError",
  storage: "StorageError",
  unauthorized: "UnauthorizedError",
} as const;

export { ErrorTag };
