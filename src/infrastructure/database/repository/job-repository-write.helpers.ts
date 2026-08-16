import type { DatabaseError } from "@app/core/errors/error.types";
import {
  DatabaseMessage,
  ExcludedRow,
  ResultColumn,
  SqlKeyword,
} from "@app/infrastructure/database/database.constants";
import type { JobRow } from "@app/infrastructure/database/database.schema";
import { jobs, results } from "@app/infrastructure/database/database.schema";
import type { PlatformDatabase } from "@app/infrastructure/database/database.types";
import {
  decodeOptionalJobRow,
  runDatabase,
} from "@app/infrastructure/database/repository/job-repository.helpers";
import { toJobUpdate } from "@app/infrastructure/database/repository/job-transition.helpers";
import { JobStatus } from "@app/modules/jobs/job.constants";
import { currentIsoTimestamp } from "@app/modules/jobs/job.factory";
import type {
  Job,
  JobProgress,
  JobResult,
  JobTransition,
} from "@app/modules/jobs/job.types";
import { canTransitionJob } from "@app/modules/jobs/job.utils";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import { Effect, Option } from "effect";

/**
 * Runs a write that returns the updated job row, then decodes it.
 *
 * @param {string} message - Stable operator-facing error message.
 * @param {(nowIso: string) => JobRow | undefined} operation - Timestamped write.
 * @returns {Effect.Effect<Option.Option<Job>, DatabaseError>} Updated job when matched.
 */
const writeReturningJob = (
  message: string,
  operation: (nowIso: string) => JobRow | undefined,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  currentIsoTimestamp().pipe(
    Effect.flatMap(
      (nowIso: string): Effect.Effect<JobRow | undefined, DatabaseError> =>
        runDatabase(message, (): JobRow | undefined => operation(nowIso)),
    ),
    Effect.flatMap(decodeOptionalJobRow),
  );

/**
 * Binds a claimed platform job to a remote engine job.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @param {string} id - Platform job identifier.
 * @param {string} engineId - Engine identifier.
 * @param {string} remoteJobId - Remote job identifier.
 * @param {string} leaseUntil - Lease deadline.
 * @returns {Effect.Effect<Option.Option<Job>, DatabaseError>} Updated job.
 */
const bindRemoteJob = (
  database: PlatformDatabase,
  id: string,
  engineId: string,
  remoteJobId: string,
  leaseUntil: string,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  writeReturningJob(
    DatabaseMessage.bindRemoteJob,
    (nowIso: string): JobRow | undefined =>
      database
        .update(jobs)
        .set({ engineId, leaseUntil, remoteJobId, updatedAt: nowIso })
        .where(and(eq(jobs.id, id), eq(jobs.status, JobStatus.running)))
        .returning()
        .get(),
  );

/**
 * Atomically claims one queued job while enforcing the global running limit.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @param {string} id - Job identifier.
 * @param {string} leaseUntil - Lease deadline.
 * @param {number} maxRunningJobs - Global running-job bound.
 * @returns {Effect.Effect<Option.Option<Job>, DatabaseError>} Claimed job.
 */
const claimQueuedJob = (
  database: PlatformDatabase,
  id: string,
  leaseUntil: string,
  maxRunningJobs: number,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  writeReturningJob(
    DatabaseMessage.claimQueuedJob,
    (nowIso: string): JobRow | undefined =>
      database.transaction((transaction): JobRow | undefined => {
        const running: number =
          transaction
            .select({ value: count() })
            .from(jobs)
            .where(eq(jobs.status, JobStatus.running))
            .get()?.value ?? 0;
        return running >= maxRunningJobs
          ? undefined
          : transaction
              .update(jobs)
              .set({
                attempt: sql`${jobs.attempt} + 1`,
                leaseUntil,
                startedAt: nowIso,
                status: JobStatus.running,
                updatedAt: nowIso,
              })
              .where(and(eq(jobs.id, id), eq(jobs.status, JobStatus.queued)))
              .returning()
              .get();
      }),
  );

/**
 * Inserts a queued job when durable queue capacity is available.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @param {Job} job - New queued job.
 * @param {number} maxQueuedJobs - Durable queue bound.
 * @returns {Effect.Effect<boolean, DatabaseError>} Whether insertion succeeded.
 */
const createJobIfCapacity = (
  database: PlatformDatabase,
  job: Job,
  maxQueuedJobs: number,
): Effect.Effect<boolean, DatabaseError> =>
  runDatabase(DatabaseMessage.insertQueuedJob, (): boolean =>
    database.transaction((transaction): boolean => {
      const queued: number =
        transaction
          .select({ value: count() })
          .from(jobs)
          .where(eq(jobs.status, JobStatus.queued))
          .get()?.value ?? 0;
      if (queued >= maxQueuedJobs) return false;
      transaction
        .insert(jobs)
        .values({
          attempt: job.attempt,
          cancelRequested: job.cancelRequested,
          cost: job.cost,
          createdAt: job.createdAt,
          id: job.id,
          model: job.request.model,
          requestJson: JSON.stringify(job.request),
          status: job.status,
          updatedAt: job.updatedAt,
        })
        .run();
      return true;
    }),
  );

/**
 * Renews the lease of a running job.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @param {string} id - Job identifier.
 * @param {string} leaseUntil - New lease deadline.
 * @returns {Effect.Effect<boolean, DatabaseError>} Whether a running job matched.
 */
const renewJobLease = (
  database: PlatformDatabase,
  id: string,
  leaseUntil: string,
): Effect.Effect<boolean, DatabaseError> =>
  currentIsoTimestamp().pipe(
    Effect.flatMap(
      (nowIso: string): Effect.Effect<boolean, DatabaseError> =>
        runDatabase(DatabaseMessage.renewLease, (): boolean =>
          Option.isSome(
            Option.fromNullable(
              database
                .update(jobs)
                .set({ leaseUntil, updatedAt: nowIso })
                .where(and(eq(jobs.id, id), eq(jobs.status, JobStatus.running)))
                .returning({ id: jobs.id })
                .get(),
            ),
          ),
        ),
    ),
  );

/**
 * Atomically cancels a queued job or requests cancellation of a running job.
 *
 * A single conditional UPDATE closes the admission/dispatcher race: the
 * statement observes either QUEUED and moves the job directly to CANCELLED, or
 * RUNNING and persists the cancellation request for the dispatcher to honour.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @param {string} id - Job identifier.
 * @returns {Effect.Effect<Option.Option<Job>, DatabaseError>} Updated cancellable job.
 */
const requestJobCancellation = (
  database: PlatformDatabase,
  id: string,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  writeReturningJob(
    DatabaseMessage.requestCancellation,
    (nowIso: string): JobRow | undefined =>
      database
        .update(jobs)
        .set({
          cancelRequested: true,
          status: sql`${sql.raw(SqlKeyword.caseWhen)} ${jobs.status} = ${JobStatus.queued} ${sql.raw(SqlKeyword.thenBranch)} ${JobStatus.cancelled} ${sql.raw(SqlKeyword.elseBranch)} ${jobs.status} ${sql.raw(SqlKeyword.end)}`,
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(jobs.id, id),
            inArray(jobs.status, [JobStatus.queued, JobStatus.running]),
          ),
        )
        .returning()
        .get(),
  );

/**
 * Saves a complete result batch atomically.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @param {readonly JobResult[]} batch - Complete result metadata batch.
 * @returns {Effect.Effect<void, DatabaseError>} Atomic persistence effect.
 */
const saveJobResults = (
  database: PlatformDatabase,
  batch: readonly JobResult[],
): Effect.Effect<void, DatabaseError> =>
  runDatabase(DatabaseMessage.saveResults, (): void => {
    if (batch.length === 0) return;
    database
      .insert(results)
      .values([...batch])
      .onConflictDoUpdate({
        set: {
          mimeType: sql.raw(`${ExcludedRow}.${ResultColumn.mimeType}`),
          path: sql.raw(`${ExcludedRow}.${ResultColumn.path}`),
          sha256: sql.raw(`${ExcludedRow}.${ResultColumn.sha256}`),
          sizeBytes: sql.raw(`${ExcludedRow}.${ResultColumn.sizeBytes}`),
        },
        target: [results.jobId, results.index],
      })
      .run();
  });

/**
 * Stores the sampling progress reported by the engine.
 *
 * Deliberately not a transition: progress is volatile telemetry, it must never
 * move a job between states nor extend its lease.
 *
 * @param {PlatformDatabase} database - Migrated Drizzle database.
 * @param {string} id - Durable job identifier.
 * @param {JobProgress} progress - Progress reported by the engine.
 * @returns {Effect.Effect<void, DatabaseError>} Durable write effect.
 */
const recordJobProgress = (
  database: PlatformDatabase,
  id: string,
  progress: JobProgress,
): Effect.Effect<void, DatabaseError> =>
  runDatabase(DatabaseMessage.recordProgress, (): void => {
    database
      .update(jobs)
      .set({ progressStep: progress.completed, progressSteps: progress.total })
      .where(and(eq(jobs.id, id), eq(jobs.status, JobStatus.running)))
      .run();
  });

/**
 * Applies one validated job state transition.
 *
 * Only the fields present in the transition reach the SET clause, so unrelated
 * metadata is preserved without any conditional SQL.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @param {JobTransition} transition - Requested domain transition.
 * @returns {Effect.Effect<Option.Option<Job>, DatabaseError>} Updated job.
 */
const transitionJob = (
  database: PlatformDatabase,
  transition: JobTransition,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  canTransitionJob(transition.from, transition.to)
    ? writeReturningJob(
        DatabaseMessage.transitionJob,
        (nowIso: string): JobRow | undefined =>
          database
            .update(jobs)
            .set(toJobUpdate(transition, nowIso))
            .where(
              and(eq(jobs.id, transition.id), eq(jobs.status, transition.from)),
            )
            .returning()
            .get(),
      )
    : Effect.succeed(Option.none<Job>());

export {
  bindRemoteJob,
  claimQueuedJob,
  createJobIfCapacity,
  recordJobProgress,
  renewJobLease,
  requestJobCancellation,
  saveJobResults,
  transitionJob,
};
