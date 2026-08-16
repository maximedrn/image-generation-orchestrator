import type { DatabaseError } from "@app/core/errors/error.types";
import { DatabaseMessage } from "@app/infrastructure/database/database.constants";
import type {
  JobRow,
  ResultRow,
} from "@app/infrastructure/database/database.schema";
import { jobs, results } from "@app/infrastructure/database/database.schema";
import type { PlatformDatabase } from "@app/infrastructure/database/database.types";
import {
  decodeJobRows,
  decodeOptionalJobRow,
  runDatabase,
  toJobResult,
} from "@app/infrastructure/database/repository/job-repository.helpers";
import { JobStatus } from "@app/modules/jobs/job.constants";
import type {
  Job,
  JobResult,
  QueuedJobHead,
} from "@app/modules/jobs/job.types";
import { and, asc, count, eq } from "drizzle-orm";
import { Effect, Option } from "effect";

/**
 * Reads the number of queued jobs.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @returns {Effect.Effect<number, DatabaseError>} Durable queue length.
 */
const countQueuedJobs = (
  database: PlatformDatabase,
): Effect.Effect<number, DatabaseError> =>
  runDatabase(
    DatabaseMessage.countQueuedJobs,
    (): number =>
      database
        .select({ value: count() })
        .from(jobs)
        .where(eq(jobs.status, JobStatus.queued))
        .get()?.value ?? 0,
  );

/**
 * Reads one job by identifier.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @param {string} id - Job identifier.
 * @returns {Effect.Effect<Option.Option<Job>, DatabaseError>} Optional decoded job.
 */
const getJobById = (
  database: PlatformDatabase,
  id: string,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  runDatabase(DatabaseMessage.readJob, (): JobRow | undefined =>
    database.select().from(jobs).where(eq(jobs.id, id)).get(),
  ).pipe(Effect.flatMap(decodeOptionalJobRow));

/**
 * Reads one persisted result descriptor.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @param {string} jobId - Job identifier.
 * @param {number} index - Zero-based result index.
 * @returns {Effect.Effect<Option.Option<JobResult>, DatabaseError>} Optional metadata.
 */
const getJobResult = (
  database: PlatformDatabase,
  jobId: string,
  index: number,
): Effect.Effect<Option.Option<JobResult>, DatabaseError> =>
  runDatabase(DatabaseMessage.readResult, (): ResultRow | undefined =>
    database
      .select()
      .from(results)
      .where(and(eq(results.jobId, jobId), eq(results.index, index)))
      .get(),
  ).pipe(Effect.map(Option.fromNullable), Effect.map(Option.map(toJobResult)));

/**
 * Lists persisted result descriptors in deterministic index order.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @param {string} jobId - Job identifier.
 * @returns {Effect.Effect<readonly JobResult[], DatabaseError>} Result metadata.
 */
const listJobResults = (
  database: PlatformDatabase,
  jobId: string,
): Effect.Effect<readonly JobResult[], DatabaseError> =>
  runDatabase(DatabaseMessage.listResults, (): readonly JobResult[] =>
    database
      .select()
      .from(results)
      .where(eq(results.jobId, jobId))
      .orderBy(asc(results.index))
      .all()
      .map(toJobResult),
  );

/**
 * Lists all running jobs for deterministic dispatcher restart recovery.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @returns {Effect.Effect<readonly Job[], DatabaseError>} Decoded running jobs.
 */
const listRunningJobs = (
  database: PlatformDatabase,
): Effect.Effect<readonly Job[], DatabaseError> =>
  runDatabase(DatabaseMessage.listRunningJobs, (): readonly JobRow[] =>
    database
      .select()
      .from(jobs)
      .where(eq(jobs.status, JobStatus.running))
      .orderBy(asc(jobs.createdAt), asc(jobs.id))
      .all(),
  ).pipe(Effect.flatMap(decodeJobRows));

/**
 * Reads the next queue head without claiming it.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @returns {Effect.Effect<Option.Option<QueuedJobHead>, DatabaseError>} Queue head.
 */
const peekNextQueuedJob = (
  database: PlatformDatabase,
): Effect.Effect<Option.Option<QueuedJobHead>, DatabaseError> =>
  runDatabase(
    DatabaseMessage.readQueueHead,
    (): { readonly id: string; readonly model: string | null } | undefined =>
      database
        .select({ id: jobs.id, model: jobs.model })
        .from(jobs)
        .where(eq(jobs.status, JobStatus.queued))
        .orderBy(asc(jobs.createdAt), asc(jobs.id))
        .limit(1)
        .get(),
  ).pipe(
    Effect.map(
      (
        row: { readonly id: string; readonly model: string | null } | undefined,
      ): Option.Option<QueuedJobHead> =>
        Option.fromNullable(row).pipe(
          Option.flatMap(
            (present: {
              readonly id: string;
              readonly model: string | null;
            }): Option.Option<QueuedJobHead> =>
              Option.fromNullable(present.model).pipe(
                Option.map(
                  (model: string): QueuedJobHead => ({ id: present.id, model }),
                ),
              ),
          ),
        ),
    ),
  );

/**
 * Verifies that the repository can execute a trivial query.
 *
 * @param {PlatformDatabase} database - Typed Drizzle database.
 * @returns {Effect.Effect<void, DatabaseError>} Successful persistence probe.
 */
const pingJobRepository = (
  database: PlatformDatabase,
): Effect.Effect<void, DatabaseError> =>
  runDatabase(DatabaseMessage.ping, (): void => {
    database.select({ value: count() }).from(jobs).get();
  });

export {
  countQueuedJobs,
  getJobById,
  getJobResult,
  listJobResults,
  listRunningJobs,
  peekNextQueuedJob,
  pingJobRepository,
};
