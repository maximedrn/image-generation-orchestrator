import type {
  DatabaseError,
  InvalidRequestError,
  JobNotCancellableError,
  JobNotFoundError,
  LimitExceededError,
  QueueFullError,
  RateLimitedError,
} from "@app/core/errors/error.types";
import type {
  Job,
  JobCreateRequest,
  JobProgress,
  JobResponse,
  JobResult,
  JobTransition,
  QueuedJobHead,
} from "@app/modules/jobs/job.types";
import type { Effect, Option } from "effect";

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
    request: JobCreateRequest,
    clientKey: string,
  ) => Effect.Effect<JobResponse, JobServiceError>;
}

/** Persistence port. Database vendors are isolated behind this interface. */
interface JobRepositoryShape {
  readonly bindRemote: (
    id: string,
    engineId: string,
    remoteJobId: string,
    leaseUntil: string,
  ) => Effect.Effect<Option.Option<Job>, DatabaseError>;
  readonly claim: (
    id: string,
    leaseUntil: string,
    maxRunningJobs: number,
  ) => Effect.Effect<Option.Option<Job>, DatabaseError>;
  readonly countQueued: () => Effect.Effect<number, DatabaseError>;
  readonly createIfCapacity: (
    job: Job,
    maxQueuedJobs: number,
  ) => Effect.Effect<boolean, DatabaseError>;
  readonly getById: (
    id: string,
  ) => Effect.Effect<Option.Option<Job>, DatabaseError>;
  readonly getResult: (
    jobId: string,
    index: number,
  ) => Effect.Effect<Option.Option<JobResult>, DatabaseError>;
  readonly listResults: (
    jobId: string,
  ) => Effect.Effect<readonly JobResult[], DatabaseError>;
  readonly listRunning: () => Effect.Effect<readonly Job[], DatabaseError>;
  readonly peekNextQueued: () => Effect.Effect<
    Option.Option<QueuedJobHead>,
    DatabaseError
  >;
  readonly ping: () => Effect.Effect<void, DatabaseError>;
  /** Records sampling progress without touching the job state machine. */
  readonly recordProgress: (
    id: string,
    progress: JobProgress,
  ) => Effect.Effect<void, DatabaseError>;
  readonly renewLease: (
    id: string,
    leaseUntil: string,
  ) => Effect.Effect<boolean, DatabaseError>;
  /** Atomically cancels queued jobs or marks running jobs for cancellation. */
  readonly requestCancellation: (
    id: string,
  ) => Effect.Effect<Option.Option<Job>, DatabaseError>;
  readonly saveResults: (
    results: readonly JobResult[],
  ) => Effect.Effect<void, DatabaseError>;
  readonly transition: (
    transition: JobTransition,
  ) => Effect.Effect<Option.Option<Job>, DatabaseError>;
}

export type { JobRepositoryShape, JobServiceError, JobServiceShape };
