import type { Database, SQLQueryBindings } from "bun:sqlite";
import { Clock, Effect, Option } from "effect";

import { DATABASE_BOOLEAN } from "@app/database/database.constants.js";
import { DatabaseError } from "@app/error/error.types.js";
import { JOB_STATUS } from "@app/job/job.constants.js";
import {
  decodeOptionalJobRow,
  readJobRow,
  runDatabase,
  transitionJobRow,
} from "@app/job/job-repository.helpers.js";
import type {
  JobRow,
  JobTransition,
} from "@app/job/job-repository.types.js";
import type { Job, JobResult } from "@app/job/job.types.js";

/**
 * Reads the Effect clock as an ISO-8601 timestamp.
 *
 * @returns (Effect.Effect<string>) Current timestamp.
 */
const currentIsoTimestamp = (): Effect.Effect<string> =>
  Clock.currentTimeMillis.pipe(
    Effect.map((epochMs: number): string => new Date(epochMs).toISOString()),
  );

/**
 * Binds a claimed platform job to a remote engine job.
 *
 * @param database - (Database) Open SQLite connection.
 * @param id - (string) Platform job identifier.
 * @param engineId - (string) Engine identifier.
 * @param remoteJobId - (string) Remote job identifier.
 * @param leaseUntil - (string) Lease deadline.
 * @returns (Effect.Effect<Option.Option<Job>, DatabaseError>) Updated job.
 */
const bindRemoteJob = (
  database: Database,
  id: string,
  engineId: string,
  remoteJobId: string,
  leaseUntil: string,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  currentIsoTimestamp().pipe(
    Effect.flatMap((nowIso: string): Effect.Effect<JobRow | null, DatabaseError> =>
      runDatabase("binding remote engine job failed", (): JobRow | null => {
        const changes: number = database.run(
          `UPDATE jobs SET engine_id = ?, remote_job_id = ?, lease_until = ?,
            updated_at = ? WHERE id = ? AND status = ?`,
          [engineId, remoteJobId, leaseUntil, nowIso, id, JOB_STATUS.RUNNING],
        ).changes;
        return changes === 0 ? null : readJobRow(database, id);
      }),
    ),
    Effect.flatMap(decodeOptionalJobRow),
  );

/**
 * Atomically claims one queued job while enforcing the global running limit.
 *
 * @param database - (Database) Open SQLite connection.
 * @param id - (string) Job identifier.
 * @param leaseUntil - (string) Lease deadline.
 * @param maxRunningJobs - (number) Global running-job bound.
 * @returns (Effect.Effect<Option.Option<Job>, DatabaseError>) Claimed job.
 */
const claimQueuedJob = (
  database: Database,
  id: string,
  leaseUntil: string,
  maxRunningJobs: number,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  currentIsoTimestamp().pipe(
    Effect.flatMap((nowIso: string): Effect.Effect<JobRow | null, DatabaseError> =>
      runDatabase("claiming queued job failed", (): JobRow | null => {
        const transaction: () => JobRow | null = database.transaction(
          (): JobRow | null => {
            const runningRow: { readonly count: number } | null = database
              .query<{ readonly count: number }, SQLQueryBindings[]>(
                "SELECT COUNT(*) AS count FROM jobs WHERE status = ?",
              )
              .get(JOB_STATUS.RUNNING);
            if ((runningRow?.count ?? 0) >= maxRunningJobs) return null;
            const changes: number = database.run(
              `UPDATE jobs SET status = ?, lease_until = ?, attempt = attempt + 1,
                updated_at = ? WHERE id = ? AND status = ?`,
              [JOB_STATUS.RUNNING, leaseUntil, nowIso, id, JOB_STATUS.QUEUED],
            ).changes;
            return changes === 0 ? null : readJobRow(database, id);
          },
        );
        return transaction();
      }),
    ),
    Effect.flatMap(decodeOptionalJobRow),
  );

/**
 * Inserts a queued job when durable queue capacity is available.
 *
 * @param database - (Database) Open SQLite connection.
 * @param job - (Job) New queued job.
 * @param maxQueuedJobs - (number) Durable queue bound.
 * @returns (Effect.Effect<boolean, DatabaseError>) Whether insertion succeeded.
 */
const createJobIfCapacity = (
  database: Database,
  job: Job,
  maxQueuedJobs: number,
): Effect.Effect<boolean, DatabaseError> =>
  runDatabase("inserting queued job failed", (): boolean => {
    const transaction: () => boolean = database.transaction((): boolean => {
      const queuedRow: { readonly count: number } | null = database
        .query<{ readonly count: number }, SQLQueryBindings[]>(
          "SELECT COUNT(*) AS count FROM jobs WHERE status = ?",
        )
        .get(JOB_STATUS.QUEUED);
      if ((queuedRow?.count ?? 0) >= maxQueuedJobs) return false;
      database.run(
        `INSERT INTO jobs (
          id, status, request_json, model, cost, created_at, updated_at,
          attempt, cancel_requested
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          job.id,
          job.status,
          JSON.stringify(job.request),
          job.request.model,
          job.cost,
          job.createdAt,
          job.updatedAt,
          job.attempt,
          job.cancelRequested ? DATABASE_BOOLEAN.TRUE : DATABASE_BOOLEAN.FALSE,
        ],
      );
      return true;
    });
    return transaction();
  });

/**
 * Renews the lease of a running job.
 *
 * @param database - (Database) Open SQLite connection.
 * @param id - (string) Job identifier.
 * @param leaseUntil - (string) New lease deadline.
 * @returns (Effect.Effect<boolean, DatabaseError>) Whether a running job matched.
 */
const renewJobLease = (
  database: Database,
  id: string,
  leaseUntil: string,
): Effect.Effect<boolean, DatabaseError> =>
  currentIsoTimestamp().pipe(
    Effect.flatMap((nowIso: string): Effect.Effect<boolean, DatabaseError> =>
      runDatabase("renewing job lease failed", (): boolean => {
        const changes: number = database.run(
          `UPDATE jobs SET lease_until = ?, updated_at = ?
           WHERE id = ? AND status = ?`,
          [leaseUntil, nowIso, id, JOB_STATUS.RUNNING],
        ).changes;
        return changes > 0;
      }),
    ),
  );

/**
 * Atomically cancels a queued job or requests cancellation of a running job.
 *
 * A single conditional UPDATE closes the admission/dispatcher race: if a queued
 * job is claimed concurrently, the statement observes either QUEUED and moves it
 * directly to CANCELLED, or RUNNING and persists the cancellation request.
 *
 * @param database - (Database) Open SQLite connection.
 * @param id - (string) Job identifier.
 * @returns (Effect.Effect<Option.Option<Job>, DatabaseError>) Updated cancellable job.
 */
const requestJobCancellation = (
  database: Database,
  id: string,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  currentIsoTimestamp().pipe(
    Effect.flatMap((nowIso: string): Effect.Effect<JobRow | null, DatabaseError> =>
      runDatabase("requesting cancellation failed", (): JobRow | null => {
        const changes: number = database.run(
          `UPDATE jobs
           SET status = CASE WHEN status = ? THEN ? ELSE status END,
               cancel_requested = ?, updated_at = ?
           WHERE id = ? AND status IN (?, ?)`,
          [
            JOB_STATUS.QUEUED,
            JOB_STATUS.CANCELLED,
            DATABASE_BOOLEAN.TRUE,
            nowIso,
            id,
            JOB_STATUS.QUEUED,
            JOB_STATUS.RUNNING,
          ],
        ).changes;
        return changes === 0 ? null : readJobRow(database, id);
      }),
    ),
    Effect.flatMap(decodeOptionalJobRow),
  );

/**
 * Saves a complete result batch atomically.
 *
 * @param database - (Database) Open SQLite connection.
 * @param results - (readonly JobResult[]) Complete result metadata batch.
 * @returns (Effect.Effect<void, DatabaseError>) Atomic persistence effect.
 */
const saveJobResults = (
  database: Database,
  results: readonly JobResult[],
): Effect.Effect<void, DatabaseError> =>
  runDatabase("saving result metadata batch failed", (): void => {
    const transaction: () => void = database.transaction((): void => {
      results.forEach((result: JobResult): void => {
        database.run(
          `INSERT OR REPLACE INTO results
           (job_id, "index", path, mime_type, size_bytes, sha256)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            result.jobId,
            result.index,
            result.path,
            result.mimeType,
            result.sizeBytes,
            result.sha256,
          ],
        );
      });
    });
    transaction();
  });

/**
 * Applies one validated job state transition.
 *
 * @param database - (Database) Open SQLite connection.
 * @param transition - (JobTransition) Requested domain transition.
 * @returns (Effect.Effect<Option.Option<Job>, DatabaseError>) Updated job.
 */
const transitionJob = (
  database: Database,
  transition: JobTransition,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  currentIsoTimestamp().pipe(
    Effect.flatMap(
      (nowIso: string): Effect.Effect<JobRow | null, DatabaseError> =>
        runDatabase(
          "transitioning job failed",
          (): JobRow | null => transitionJobRow(database, transition, nowIso),
        ),
    ),
    Effect.flatMap(decodeOptionalJobRow),
  );

export {
  bindRemoteJob,
  claimQueuedJob,
  createJobIfCapacity,
  currentIsoTimestamp,
  renewJobLease,
  requestJobCancellation,
  saveJobResults,
  transitionJob,
};
