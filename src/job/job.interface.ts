import type { Effect } from "effect";

import type {
  DatabaseError,
  InvalidRequestError,
  JobNotCancellableError,
  JobNotFoundError,
  LimitExceededError,
  QueueFullError,
  RateLimitedError,
} from "@app/error/error.types.js";
import type {
  JobResponse,
  JobResult,
} from "@app/job/job.types.js";

/** Errors exposed by job application use cases. */
type JobServiceError =
  | DatabaseError
  | InvalidRequestError
  | JobNotCancellableError
  | JobNotFoundError
  | LimitExceededError
  | QueueFullError
  | RateLimitedError;

/** Application port consumed by the NestJS HTTP adapter. */
interface JobServiceShape {
  readonly cancel: (id: string) => Effect.Effect<JobResponse, JobServiceError>;
  readonly get: (id: string) => Effect.Effect<JobResponse, JobServiceError>;
  readonly getResult: (
    id: string,
    index: number,
  ) => Effect.Effect<JobResult, DatabaseError | JobNotFoundError>;
  readonly submit: (
    input: unknown,
    clientKey: string,
  ) => Effect.Effect<JobResponse, JobServiceError>;
}

export type { JobServiceError, JobServiceShape };
