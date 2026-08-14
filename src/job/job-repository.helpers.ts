import type { Database, SQLQueryBindings } from "bun:sqlite";
import { Effect, Option, Schema } from "effect";

import { DATABASE_BOOLEAN } from "@app/database/database.constants.js";
import { DatabaseError } from "@app/error/error.types.js";
import type {
  Job,
  JobCreateRequest,
  JobResult,
  JobStatus,
} from "@app/job/job.types.js";
import {
  JobCreateRequestSchema,
  JobStatusSchema,
} from "@app/job/job.types.js";
import type {
  JobResultRow,
  JobRow,
  JobTransition,
  JobTransitionChanges,
} from "@app/job/job-repository.types.js";
import { canTransitionJob } from "@app/job/job.utils.js";

/** Common job projection used by all SQLite repository reads. */
const JOB_SELECT_COLUMNS = `
  id,
  status,
  request_json AS "requestJson",
  cost,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  attempt,
  engine_id AS "engineId",
  remote_job_id AS "remoteJobId",
  lease_until AS "leaseUntil",
  error_code AS "errorCode",
  error_message AS "errorMessage",
  model,
  cancel_requested AS "cancelRequested"
`;

/** Common result projection used by all SQLite repository reads. */
const RESULT_SELECT_COLUMNS = `
  job_id AS "jobId",
  "index" AS "index",
  path,
  mime_type AS "mimeType",
  size_bytes AS "sizeBytes",
  sha256
`;

/**
 * Decodes one stored JSON request without unsafe casting.
 *
 * @param json - (string) Stored JSON document.
 * @returns (Effect.Effect<JobCreateRequest, DatabaseError>) Decoded request.
 */
const decodeStoredRequest = (
  json: string,
): Effect.Effect<JobCreateRequest, DatabaseError> =>
  Effect.try({
    catch: (cause: unknown): DatabaseError =>
      new DatabaseError({ cause, message: "stored job request is invalid JSON" }),
    try: (): unknown => JSON.parse(json),
  }).pipe(
    Effect.flatMap((value: unknown): Effect.Effect<JobCreateRequest, DatabaseError> =>
      Schema.decodeUnknown(JobCreateRequestSchema)(value).pipe(
        Effect.mapError(
          (cause: unknown): DatabaseError =>
            new DatabaseError({
              cause,
              message: "stored job request violates the current schema",
            }),
        ),
      ),
    ),
  );

/**
 * Converts a validated database row into the domain representation.
 *
 * @param row - (JobRow) Raw SQLite row.
 * @returns (Effect.Effect<Job, DatabaseError>) Fully decoded job.
 */
const decodeJobRow = (row: JobRow): Effect.Effect<Job, DatabaseError> =>
  Effect.gen(function* decodeJobRowEffect(): Generator<unknown, Job> {
    const request: JobCreateRequest = yield* decodeStoredRequest(row.requestJson);
    const status: JobStatus = yield* Schema.decodeUnknown(JobStatusSchema)(row.status).pipe(
      Effect.mapError(
        (cause: unknown): DatabaseError =>
          new DatabaseError({ cause, message: "stored job status is invalid" }),
      ),
    );
    const optionalFields: Partial<Job> = {
      ...(row.engineId === null ? {} : { engineId: row.engineId }),
      ...(row.errorCode === null ? {} : { errorCode: row.errorCode }),
      ...(row.errorMessage === null ? {} : { errorMessage: row.errorMessage }),
      ...(row.leaseUntil === null ? {} : { leaseUntil: row.leaseUntil }),
      ...(row.remoteJobId === null ? {} : { remoteJobId: row.remoteJobId }),
    };
    return {
      ...optionalFields,
      attempt: row.attempt,
      cancelRequested: row.cancelRequested === DATABASE_BOOLEAN.TRUE,
      cost: row.cost,
      createdAt: row.createdAt,
      id: row.id,
      request,
      status,
      updatedAt: row.updatedAt,
    };
  });

/**
 * Converts a nullable raw row into an Effect Option of a decoded job.
 *
 * @param row - (JobRow | null) Nullable SQLite row.
 * @returns (Effect.Effect<Option.Option<Job>, DatabaseError>) Optional decoded job.
 */
const decodeOptionalJobRow = (
  row: JobRow | null,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  row === null
    ? Effect.succeed(Option.none<Job>())
    : decodeJobRow(row).pipe(Effect.map(Option.some));

/**
 * Converts a raw result row into stable public metadata.
 *
 * @param row - (JobResultRow) Raw SQLite row.
 * @returns (JobResult) Domain result metadata.
 */
const decodeResultRow = (row: JobResultRow): JobResult => ({
  index: row.index,
  jobId: row.jobId,
  mimeType: row.mimeType,
  path: row.path,
  sha256: row.sha256,
  sizeBytes: row.sizeBytes,
});

/**
 * Wraps a synchronous SQLite operation in an explicit typed Effect error channel.
 *
 * @param message - (string) Stable operator-facing error message.
 * @param operation - (() => A) Synchronous database operation.
 * @returns (Effect.Effect<A, DatabaseError>) Wrapped operation.
 */
const runDatabase = <A>(
  message: string,
  operation: () => A,
): Effect.Effect<A, DatabaseError> =>
  Effect.try({
    catch: (cause: unknown): DatabaseError =>
      new DatabaseError({ cause, message }),
    try: operation,
  });


/**
 * Reads a job by identifier from SQLite.
 *
 * @param database - (Database) Open SQLite connection.
 * @param id - (string) Job identifier.
 * @returns (JobRow | null) Raw row when present.
 */
const readJobRow = (database: Database, id: string): JobRow | null =>
  database
    .query<JobRow, SQLQueryBindings[]>(
      `SELECT ${JOB_SELECT_COLUMNS} FROM jobs WHERE id = ?`,
    )
    .get(id) ?? null;

/**
 * Converts an optional transition field to a SQLite CASE update flag.
 *
 * @param value - (unknown) Optional transition value.
 * @returns (number) SQLite integer boolean indicating whether to replace the field.
 */
const changeFlag = (value: unknown): number =>
  value === undefined ? DATABASE_BOOLEAN.FALSE : DATABASE_BOOLEAN.TRUE;

/**
 * Applies one explicit state transition while preserving unspecified metadata.
 *
 * @param database - (Database) Open SQLite connection.
 * @param transition - (JobTransition) Requested transition and metadata changes.
 * @param nowIso - (string) Effect-clock timestamp supplied by the adapter.
 * @returns (JobRow | null) Updated row or null when the precondition did not match.
 */
const transitionJobRow = (
  database: Database,
  transition: JobTransition,
  nowIso: string,
): JobRow | null => {
  if (!canTransitionJob(transition.from, transition.to)) {
    return null;
  }
  const changes: JobTransitionChanges = transition.changes;
  const updateChanges: number = database.run(
    `UPDATE jobs SET
      status = ?, updated_at = ?,
      engine_id = CASE WHEN ? = ${DATABASE_BOOLEAN.TRUE} THEN ? ELSE engine_id END,
      remote_job_id = CASE WHEN ? = ${DATABASE_BOOLEAN.TRUE} THEN ? ELSE remote_job_id END,
      lease_until = CASE WHEN ? = ${DATABASE_BOOLEAN.TRUE} THEN ? ELSE lease_until END,
      error_code = CASE WHEN ? = ${DATABASE_BOOLEAN.TRUE} THEN ? ELSE error_code END,
      error_message = CASE WHEN ? = ${DATABASE_BOOLEAN.TRUE} THEN ? ELSE error_message END,
      cancel_requested = CASE WHEN ? = ${DATABASE_BOOLEAN.TRUE} THEN ? ELSE cancel_requested END
     WHERE id = ? AND status = ?`,
    [
      transition.to, nowIso,
      changeFlag(changes.engineId), changes.engineId ?? null,
      changeFlag(changes.remoteJobId), changes.remoteJobId ?? null,
      changeFlag(changes.leaseUntil), changes.leaseUntil ?? null,
      changeFlag(changes.errorCode), changes.errorCode ?? null,
      changeFlag(changes.errorMessage), changes.errorMessage ?? null,
      changeFlag(changes.cancelRequested),
      changes.cancelRequested === true ? DATABASE_BOOLEAN.TRUE : DATABASE_BOOLEAN.FALSE,
      transition.id, transition.from,
    ],
  ).changes;
  return updateChanges === 0 ? null : readJobRow(database, transition.id);
};

export {
  changeFlag,
  decodeJobRow,
  decodeOptionalJobRow,
  decodeResultRow,
  JOB_SELECT_COLUMNS,
  readJobRow,
  RESULT_SELECT_COLUMNS,
  runDatabase,
  transitionJobRow,
};
