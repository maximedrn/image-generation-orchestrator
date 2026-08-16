import { DatabaseError } from "@app/core/errors/error.types";
import {
  DatabaseMessage,
  OptionalJobField,
} from "@app/infrastructure/database/database.constants";
import type {
  JobRow,
  ResultRow,
} from "@app/infrastructure/database/database.schema";
import {
  JobCreateRequestSchema,
  JobStatusSchema,
} from "@app/modules/jobs/job.schema";
import type {
  Job,
  JobCreateRequest,
  JobResult,
  JobStatusValue,
} from "@app/modules/jobs/job.types";
import { Effect, Option, Schema } from "effect";

/**
 * Wraps a synchronous Drizzle operation in an explicit typed error channel.
 *
 * @param {string} message - Stable operator-facing error message.
 * @param {() => A} operation - Synchronous database operation.
 * @returns {Effect.Effect<A, DatabaseError>} Wrapped operation.
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
 * Decodes one stored JSON request without unsafe casting.
 *
 * @param {string} json - Stored JSON document.
 * @returns {Effect.Effect<JobCreateRequest, DatabaseError>} Decoded request.
 */
const decodeStoredRequest = (
  json: string,
): Effect.Effect<JobCreateRequest, DatabaseError> =>
  Effect.try({
    catch: (cause: unknown): DatabaseError =>
      new DatabaseError({
        cause,
        message: DatabaseMessage.invalidStoredRequest,
      }),
    try: (): unknown => JSON.parse(json),
  }).pipe(
    Effect.flatMap(
      (value: unknown): Effect.Effect<JobCreateRequest, DatabaseError> =>
        Schema.decodeUnknown(JobCreateRequestSchema)(value).pipe(
          Effect.mapError(
            (cause: unknown): DatabaseError =>
              new DatabaseError({
                cause,
                message: DatabaseMessage.staleStoredRequest,
              }),
          ),
        ),
    ),
  );

/**
 * Copies one optional column into the domain job only when it is present.
 *
 * @param {K} key - Optional job property name.
 * @param {string | null} value - Nullable column value.
 * @returns {Partial<Job>} Empty object or a single-property patch.
 */
const optionalField = <
  K extends (typeof OptionalJobField)[keyof typeof OptionalJobField],
>(
  key: K,
  value: string | null,
): Partial<Job> =>
  Option.match(Option.fromNullable(value), {
    onNone: (): Partial<Job> => ({}),
    onSome: (present: string): Partial<Job> => ({ [key]: present }),
  });

/**
 * Converts a validated database row into the domain representation.
 *
 * @param {JobRow} row - Row selected through the Drizzle schema.
 * @returns {Effect.Effect<Job, DatabaseError>} Fully decoded job.
 */
const decodeJobRow = (row: JobRow): Effect.Effect<Job, DatabaseError> =>
  Effect.all([
    decodeStoredRequest(row.requestJson),
    Schema.decodeUnknown(JobStatusSchema)(row.status).pipe(
      Effect.mapError(
        (cause: unknown): DatabaseError =>
          new DatabaseError({
            cause,
            message: DatabaseMessage.invalidStoredStatus,
          }),
      ),
    ),
  ]).pipe(
    Effect.map(
      ([request, status]: readonly [
        JobCreateRequest,
        JobStatusValue,
      ]): Job => ({
        ...optionalField(OptionalJobField.engineId, row.engineId),
        ...optionalField(OptionalJobField.errorCode, row.errorCode),
        ...optionalField(OptionalJobField.errorMessage, row.errorMessage),
        ...optionalField(OptionalJobField.leaseUntil, row.leaseUntil),
        ...optionalField(OptionalJobField.remoteJobId, row.remoteJobId),
        attempt: row.attempt,
        cancelRequested: row.cancelRequested,
        cost: row.cost,
        createdAt: row.createdAt,
        id: row.id,
        request,
        status,
        updatedAt: row.updatedAt,
      }),
    ),
  );

/**
 * Converts an optional raw row into an Effect Option of a decoded job.
 *
 * @param {JobRow | undefined} row - Row when the statement matched.
 * @returns {Effect.Effect<Option.Option<Job>, DatabaseError>} Optional decoded job.
 */
const decodeOptionalJobRow = (
  row: JobRow | undefined,
): Effect.Effect<Option.Option<Job>, DatabaseError> =>
  Option.match(Option.fromNullable(row), {
    onNone: (): Effect.Effect<Option.Option<Job>, DatabaseError> =>
      Effect.succeed(Option.none<Job>()),
    onSome: (
      present: JobRow,
    ): Effect.Effect<Option.Option<Job>, DatabaseError> =>
      decodeJobRow(present).pipe(Effect.map(Option.some)),
  });

/**
 * Decodes every row of a batch in a deterministic order.
 *
 * @param {readonly JobRow[]} rows - Rows selected through the Drizzle schema.
 * @returns {Effect.Effect<readonly Job[], DatabaseError>} Decoded jobs.
 */
const decodeJobRows = (
  rows: readonly JobRow[],
): Effect.Effect<readonly Job[], DatabaseError> =>
  Effect.forEach(rows, decodeJobRow, { concurrency: 1 });

/**
 * Converts a raw result row into stable public metadata.
 *
 * The Drizzle schema already produces the domain field names, so this only
 * narrows the row to the public shape.
 *
 * @param {ResultRow} row - Row selected through the Drizzle schema.
 * @returns {JobResult} Domain result metadata.
 */
const toJobResult = (row: ResultRow): JobResult => ({
  index: row.index,
  jobId: row.jobId,
  mimeType: row.mimeType,
  path: row.path,
  sha256: row.sha256,
  sizeBytes: row.sizeBytes,
});

export {
  decodeJobRow,
  decodeJobRows,
  decodeOptionalJobRow,
  decodeStoredRequest,
  optionalField,
  runDatabase,
  toJobResult,
};
