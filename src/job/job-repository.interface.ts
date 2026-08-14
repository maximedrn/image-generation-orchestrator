import type { Effect, Option } from "effect";

import type { DatabaseError } from "@app/error/error.types.js";
import type {
  Job,
  JobResult,
  QueuedJobHead,
} from "@app/job/job.types.js";
import type { JobTransition } from "@app/job/job-repository.types.js";

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
  readonly renewLease: (
    id: string,
    leaseUntil: string,
  ) => Effect.Effect<boolean, DatabaseError>;
  /** Atomically cancels QUEUED jobs or marks RUNNING jobs for cancellation. */
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

export type { JobRepositoryShape };
