import { Data } from "effect";

import { ERROR_TAG } from "@app/error/error.constants.js";

/** Configuration loading or validation failure. */
class ConfigError extends Data.TaggedError(ERROR_TAG.CONFIG)<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

/** Durable database operation failure. */
class DatabaseError extends Data.TaggedError(ERROR_TAG.DATABASE)<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

/** Engine endpoint could not be reached or is circuit-open. */
class EngineUnavailableError extends Data.TaggedError(ERROR_TAG.ENGINE_UNAVAILABLE)<{
  readonly engineId?: string;
  readonly message: string;
}> {}

/** Engine returned a payload that does not satisfy its explicit contract. */
class EngineProtocolError extends Data.TaggedError(ERROR_TAG.ENGINE_PROTOCOL)<{
  readonly cause?: unknown;
  readonly engineId: string;
  readonly message: string;
}> {}

/** Engine explicitly rejected a valid platform request. */
class EngineRejectedError extends Data.TaggedError(ERROR_TAG.ENGINE_REJECTED)<{
  readonly engineId: string;
  readonly message: string;
  readonly statusCode: number;
}> {}

/** User input does not satisfy the public API contract. */
class InvalidRequestError extends Data.TaggedError(ERROR_TAG.INVALID_REQUEST)<{
  readonly message: string;
}> {}

/** Requested job cannot be cancelled in its current terminal state. */
class JobNotCancellableError extends Data.TaggedError(ERROR_TAG.JOB_NOT_CANCELLABLE)<{
  readonly id: string;
  readonly message: string;
}> {}

/** Requested job identifier does not exist. */
class JobNotFoundError extends Data.TaggedError(ERROR_TAG.JOB_NOT_FOUND)<{
  readonly id: string;
}> {}

/** Configured platform limit has been exceeded. */
class LimitExceededError extends Data.TaggedError(ERROR_TAG.LIMIT_EXCEEDED)<{
  readonly limit: string;
  readonly message: string;
}> {}

/** Durable admission queue cannot accept more work. */
class QueueFullError extends Data.TaggedError(ERROR_TAG.QUEUE_FULL)<{
  readonly message: string;
  readonly retryAfterSeconds: number;
}> {}

/** Local request rate limit has been exceeded. */
class RateLimitedError extends Data.TaggedError(ERROR_TAG.RATE_LIMITED)<{
  readonly message: string;
  readonly retryAfterSeconds: number;
}> {}

/** Result file persistence or retrieval failure. */
class StorageError extends Data.TaggedError(ERROR_TAG.STORAGE)<{
  readonly cause?: unknown;
  readonly message: string;
}> {}

/** Bearer authentication failed. */
class UnauthorizedError extends Data.TaggedError(ERROR_TAG.UNAUTHORIZED)<{
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
  QueueFullError,
  RateLimitedError,
  StorageError,
  UnauthorizedError,
};
