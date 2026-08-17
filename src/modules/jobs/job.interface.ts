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
  /** Cancels a queued job, or records the request for a running one. */
  readonly cancel: (id: string) => Effect.Effect<JobResponse, JobServiceError>;
  /** Reads one job with the URLs of the results it produced. */
  readonly get: (id: string) => Effect.Effect<JobResponse, JobServiceError>;
  /** Reads the metadata of one generated image, for streaming it back. */
  readonly getResult: (
    id: string,
    index: number,
  ) => Effect.Effect<JobResult, DatabaseError | JobNotFoundError>;
  /** Admits one request into the queue, or rejects it against the limits. */
  readonly submit: (
    request: JobCreateRequest,
    clientKey: string,
  ) => Effect.Effect<JobResponse, JobServiceError>;
}

/** Persistence port. Database vendors are isolated behind this interface. */
interface JobRepositoryShape {
  /** Attaches the engine and its remote identifier to a claimed job. */
  readonly bindRemote: (
    id: string,
    engineId: string,
    remoteJobId: string,
    leaseUntil: string,
  ) => Effect.Effect<Option.Option<Job>, DatabaseError>;
  /** Moves one queued job to running under a lease, if capacity allows. */
  readonly claim: (
    id: string,
    leaseUntil: string,
    maxRunningJobs: number,
  ) => Effect.Effect<Option.Option<Job>, DatabaseError>;
  /** Counts the jobs still waiting for an engine. */
  readonly countQueued: () => Effect.Effect<number, DatabaseError>;
  /** Inserts one job unless the queue is already at its bound. */
  readonly createIfCapacity: (
    job: Job,
    maxQueuedJobs: number,
  ) => Effect.Effect<boolean, DatabaseError>;
  /** Reads one durable job. */
  readonly getById: (
    id: string,
  ) => Effect.Effect<Option.Option<Job>, DatabaseError>;
  /** Reads the metadata of one result of a job. */
  readonly getResult: (
    jobId: string,
    index: number,
  ) => Effect.Effect<Option.Option<JobResult>, DatabaseError>;
  /** Lists every result a job produced, in index order. */
  readonly listResults: (
    jobId: string,
  ) => Effect.Effect<readonly JobResult[], DatabaseError>;
  /** Lists the running jobs, which recovery scans for expired leases. */
  readonly listRunning: () => Effect.Effect<readonly Job[], DatabaseError>;
  /** Reads the head of the queue without claiming it. */
  readonly peekNextQueued: () => Effect.Effect<
    Option.Option<QueuedJobHead>,
    DatabaseError
  >;
  /** Probes the database, so readiness fails before traffic arrives. */
  readonly ping: () => Effect.Effect<void, DatabaseError>;
  /** Records sampling progress without touching the job state machine. */
  readonly recordProgress: (
    id: string,
    progress: JobProgress,
  ) => Effect.Effect<void, DatabaseError>;
  /** Extends the lease of a job still being worked on. */
  readonly renewLease: (
    id: string,
    leaseUntil: string,
  ) => Effect.Effect<boolean, DatabaseError>;
  /** Atomically cancels queued jobs or marks running jobs for cancellation. */
  readonly requestCancellation: (
    id: string,
  ) => Effect.Effect<Option.Option<Job>, DatabaseError>;
  /** Persists the metadata of every image of one job, atomically. */
  readonly saveResults: (
    results: readonly JobResult[],
  ) => Effect.Effect<void, DatabaseError>;
  /** Applies one guarded state change, returning nothing when it no longer applies. */
  readonly transition: (
    transition: JobTransition,
  ) => Effect.Effect<Option.Option<Job>, DatabaseError>;
}

export type { JobRepositoryShape, JobServiceError, JobServiceShape };
