import type { Database, SQLQueryBindings } from "bun:sqlite";
import { Effect, Option } from "effect";

import { DatabaseError } from "@app/error/error.types.js";
import { JOB_STATUS } from "@app/job/job.constants.js";
import {
  decodeJobRow,
  JOB_SELECT_COLUMNS,
  decodeOptionalJobRow,
  decodeResultRow,
  readJobRow,
  RESULT_SELECT_COLUMNS,
  runDatabase,
} from "@app/job/job-repository.helpers.js";
import type {
  JobResultRow,
  JobRow,
} from "@app/job/job-repository.types.js";
import type { Job, JobResult, QueuedJobHead } from "@app/job/job.types.js";

/**
 * Reads the number of queued jobs from SQLite.
 *
 * @param database - (Database) Open SQLite connection.
 * @returns (Effect.Effect<number, DatabaseError>) Durable queue length.
 */
const countQueuedJobs = (
  database: Database,
): Effect.Effect<number, DatabaseError> =>
  runDatabase("counting queued jobs failed", (): number => {
    const row: { readonly count: number } | null = database
      .query<{ readonly count: number }, SQLQueryBindings[]>(
        "SELECT COUNT(*) AS count FROM jobs WHERE status = ?",
      )
      .get(JOB_STATUS.QUEUED);
    return row?.count ?? 0;
  });

/**
 * Reads one job by identifier.
 *
 * @param database - (Database) Open SQLite connection.
 * @param id - (string) Job identifier.
 * @returns (Effect.Effect<Option.Option<Job>, DatabaseError>) Optional decoded job.
 */
const getJobById = (
  database: Database,
  id: string,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  runDatabase(
    "reading job failed",
    (): JobRow | null => readJobRow(database, id),
  ).pipe(Effect.flatMap(decodeOptionalJobRow));

/**
 * Reads one persisted result descriptor.
 *
 * @param database - (Database) Open SQLite connection.
 * @param jobId - (string) Job identifier.
 * @param index - (number) Zero-based result index.
 * @returns (Effect.Effect<Option.Option<JobResult>, DatabaseError>) Optional metadata.
 */
const getJobResult = (
  database: Database,
  jobId: string,
  index: number,
): Effect.Effect<Option.Option<JobResult>, DatabaseError> =>
  runDatabase("reading result metadata failed", (): Option.Option<JobResult> => {
    const row: JobResultRow | null =
      database
        .query<JobResultRow, SQLQueryBindings[]>(
          `SELECT ${RESULT_SELECT_COLUMNS} FROM results
           WHERE job_id = ? AND "index" = ?`,
        )
        .get(jobId, index) ?? null;
    return row === null
      ? Option.none<JobResult>()
      : Option.some(decodeResultRow(row));
  });

/**
 * Lists persisted result descriptors in deterministic index order.
 *
 * @param database - (Database) Open SQLite connection.
 * @param jobId - (string) Job identifier.
 * @returns (Effect.Effect<readonly JobResult[], DatabaseError>) Result metadata.
 */
const listJobResults = (
  database: Database,
  jobId: string,
): Effect.Effect<readonly JobResult[], DatabaseError> =>
  runDatabase("listing result metadata failed", (): readonly JobResult[] =>
    database
      .query<JobResultRow, SQLQueryBindings[]>(
        `SELECT ${RESULT_SELECT_COLUMNS} FROM results
         WHERE job_id = ? ORDER BY "index" ASC`,
      )
      .all(jobId)
      .map((row: JobResultRow): JobResult => decodeResultRow(row)),
  );


/**
 * Lists all running jobs for deterministic dispatcher restart recovery.
 *
 * @param database - (Database) Open SQLite connection.
 * @returns (Effect.Effect<readonly Job[], DatabaseError>) Decoded running jobs.
 */
const listRunningJobs = (
  database: Database,
): Effect.Effect<readonly Job[], DatabaseError> =>
  runDatabase("listing running jobs failed", (): readonly JobRow[] =>
    database
      .query<JobRow, SQLQueryBindings[]>(
        `SELECT ${JOB_SELECT_COLUMNS} FROM jobs
         WHERE status = ? ORDER BY created_at ASC, id ASC`,
      )
      .all(JOB_STATUS.RUNNING),
  ).pipe(
    Effect.flatMap(
      (rows: readonly JobRow[]): Effect.Effect<readonly Job[], DatabaseError> =>
        Effect.all(
          rows.map((row: JobRow): Effect.Effect<Job, DatabaseError> =>
            decodeJobRow(row),
          ),
          { concurrency: 1 },
        ),
    ),
  );

/**
 * Reads the next queue head without claiming it.
 *
 * @param database - (Database) Open SQLite connection.
 * @returns (Effect.Effect<Option.Option<QueuedJobHead>, DatabaseError>) Queue head.
 */
const peekNextQueuedJob = (
  database: Database,
): Effect.Effect<Option.Option<QueuedJobHead>, DatabaseError> =>
  runDatabase("reading queue head failed", (): Option.Option<QueuedJobHead> => {
    const row: QueuedJobHead | null =
      database
        .query<QueuedJobHead, SQLQueryBindings[]>(
          `SELECT id, model FROM jobs
           WHERE status = ? ORDER BY created_at ASC, id ASC LIMIT 1`,
        )
        .get(JOB_STATUS.QUEUED) ?? null;
    return row === null
      ? Option.none<QueuedJobHead>()
      : Option.some(row);
  });

/**
 * Verifies that the SQLite repository can execute a trivial query.
 *
 * @param database - (Database) Open SQLite connection.
 * @returns (Effect.Effect<void, DatabaseError>) Successful persistence probe.
 */
const pingJobRepository = (
  database: Database,
): Effect.Effect<void, DatabaseError> =>
  runDatabase("repository ping failed", (): void => {
    database.query("SELECT 1 AS ok").get();
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
