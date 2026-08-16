import {
  ColumnMode,
  IndexName,
  JobColumn,
  ResultColumn,
  TableName,
} from "@app/infrastructure/database/database.constants";
import {
  index,
  integer,
  // biome-ignore lint/suspicious/noDeprecatedImports: overload.
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

/** Attempt counter carried by a freshly admitted job. */
const InitialAttempt: number = 0;

/** Cancellation flag carried by a freshly admitted job. */
const InitialCancelRequested: boolean = false;

/** Durable job queue. One row per admitted generation request. */
const jobs = sqliteTable(
  TableName.jobs,
  {
    attempt: integer(JobColumn.attempt).notNull().default(InitialAttempt),
    cancelRequested: integer(JobColumn.cancelRequested, {
      mode: ColumnMode.boolean,
    })
      .notNull()
      .default(InitialCancelRequested),
    cost: integer(JobColumn.cost).notNull(),
    createdAt: text(JobColumn.createdAt).notNull(),
    engineId: text(JobColumn.engineId),
    errorCode: text(JobColumn.errorCode),
    errorMessage: text(JobColumn.errorMessage),
    id: text(JobColumn.id).primaryKey(),
    leaseUntil: text(JobColumn.leaseUntil),
    model: text(JobColumn.model),
    remoteJobId: text(JobColumn.remoteJobId),
    requestJson: text(JobColumn.requestJson).notNull(),
    startedAt: text(JobColumn.startedAt),
    status: text(JobColumn.status).notNull(),
    updatedAt: text(JobColumn.updatedAt).notNull(),
  },
  (table) => [
    index(IndexName.jobsQueue).on(table.status, table.createdAt, table.id),
    index(IndexName.jobsRunningLease).on(table.status, table.leaseUntil),
    index(IndexName.jobsModelStatus).on(table.model, table.status),
  ],
);

/** Metadata of every generated artefact persisted by the result storage. */
const results = sqliteTable(
  TableName.results,
  {
    index: integer(ResultColumn.index).notNull(),
    jobId: text(ResultColumn.jobId).notNull(),
    mimeType: text(ResultColumn.mimeType).notNull(),
    path: text(ResultColumn.path).notNull(),
    sha256: text(ResultColumn.sha256).notNull(),
    sizeBytes: integer(ResultColumn.sizeBytes).notNull(),
  },
  (table) => [primaryKey({ columns: [table.jobId, table.index] })],
);

/** Raw job row exactly as Drizzle selects it. */
type JobRow = typeof jobs.$inferSelect;

/** Raw result row exactly as Drizzle selects it. */
type ResultRow = typeof results.$inferSelect;

export type { JobRow, ResultRow };
export { jobs, results };
