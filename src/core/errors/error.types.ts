import { ErrorTag } from "@app/core/errors/error.constants";
import { Data } from "effect";

/** Configuration loading or validation failure. */
class ConfigError extends Data.TaggedError(ErrorTag.config)<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

/** Durable database operation failure. */
class DatabaseError extends Data.TaggedError(ErrorTag.database)<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

/** Engine endpoint could not be reached or is circuit-open. */
class EngineUnavailableError extends Data.TaggedError(
  ErrorTag.engineUnavailable,
)<{
  readonly engineId?: string;
  readonly message: string;
}> {}

/** Engine returned a payload that does not satisfy its explicit contract. */
class EngineProtocolError extends Data.TaggedError(ErrorTag.engineProtocol)<{
  readonly cause?: unknown;
  readonly engineId: string;
  readonly message: string;
}> {}

/** Engine explicitly rejected a valid platform request. */
class EngineRejectedError extends Data.TaggedError(ErrorTag.engineRejected)<{
  readonly engineId: string;
  readonly message: string;
  readonly statusCode: number;
}> {}

/** User input does not satisfy the public API contract. */
class InvalidRequestError extends Data.TaggedError(ErrorTag.invalidRequest)<{
  readonly message: string;
}> {}

/** Requested job cannot be cancelled in its current terminal state. */
class JobNotCancellableError extends Data.TaggedError(
  ErrorTag.jobNotCancellable,
)<{
  readonly id: string;
  readonly message: string;
}> {}

/** Requested job identifier does not exist. */
class JobNotFoundError extends Data.TaggedError(ErrorTag.jobNotFound)<{
  readonly id: string;
}> {}

/** Configured platform limit has been exceeded. */
class LimitExceededError extends Data.TaggedError(ErrorTag.limitExceeded)<{
  readonly limit: string;
  readonly message: string;
}> {}

/** Declared model could not be fetched into the local model directory. */
class ModelDownloadError extends Data.TaggedError(ErrorTag.modelDownload)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly model: string;
}> {}

/** Durable admission queue cannot accept more work. */
class QueueFullError extends Data.TaggedError(ErrorTag.queueFull)<{
  readonly message: string;
  readonly retryAfterSeconds: number;
}> {}

/** Local request rate limit has been exceeded. */
class RateLimitedError extends Data.TaggedError(ErrorTag.rateLimited)<{
  readonly message: string;
  readonly retryAfterSeconds: number;
}> {}

/** Result file persistence or retrieval failure. */
class StorageError extends Data.TaggedError(ErrorTag.storage)<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

/** Bearer authentication failed. */
class UnauthorizedError extends Data.TaggedError(ErrorTag.unauthorized)<{
  readonly message: string;
}> {}

/** Exhaustive typed error channel used by application effects. */
type PlatformError =
  | ConfigError
  | DatabaseError
  | EngineProtocolError
  | EngineRejectedError
  | EngineUnavailableError
  | InvalidRequestError
  | JobNotCancellableError
  | JobNotFoundError
  | LimitExceededError
  | ModelDownloadError
  | QueueFullError
  | RateLimitedError
  | StorageError
  | UnauthorizedError;

export type { PlatformError };
export {
  ConfigError,
  DatabaseError,
  EngineProtocolError,
  EngineRejectedError,
  EngineUnavailableError,
  InvalidRequestError,
  JobNotCancellableError,
  JobNotFoundError,
  LimitExceededError,
  ModelDownloadError,
  QueueFullError,
  RateLimitedError,
  StorageError,
  UnauthorizedError,
};
