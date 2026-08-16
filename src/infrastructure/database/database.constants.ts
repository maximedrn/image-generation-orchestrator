/** Durable SQLite connection settings applied once at acquisition. */
const DatabaseSettings = {
  busyTimeoutMs: 5000,
  fileName: "app.sqlite",
  journalSizeLimitBytes: 64 * 1024 * 1024,
  migrationsFolder: "src/infrastructure/database/drizzle",
} as const;

/** Physical table names. */
const TableName = {
  jobs: "jobs",
  results: "results",
} as const;

/** Physical column names of the durable job queue. */
const JobColumn = {
  attempt: "attempt",
  cancelRequested: "cancel_requested",
  cost: "cost",
  createdAt: "created_at",
  engineId: "engine_id",
  errorCode: "error_code",
  errorMessage: "error_message",
  id: "id",
  leaseUntil: "lease_until",
  model: "model",
  progressStep: "progress_step",
  progressSteps: "progress_steps",
  remoteJobId: "remote_job_id",
  requestJson: "request_json",
  startedAt: "started_at",
  status: "status",
  updatedAt: "updated_at",
} as const;

/** Physical column names of the persisted result metadata. */
const ResultColumn = {
  index: "index",
  jobId: "job_id",
  mimeType: "mime_type",
  path: "path",
  sha256: "sha256",
  sizeBytes: "size_bytes",
} as const;

/** Secondary index names, referenced by the schema and by the migrations. */
const IndexName = {
  jobsModelStatus: "idx_jobs_model_status",
  jobsQueue: "idx_jobs_queue",
  jobsRunningLease: "idx_jobs_running_lease",
} as const;

/** Domain property names of the optional columns copied onto a decoded job. */
const OptionalJobField = {
  engineId: "engineId",
  errorCode: "errorCode",
  errorMessage: "errorMessage",
  leaseUntil: "leaseUntil",
  remoteJobId: "remoteJobId",
} as const;

/**
 * Optional job properties copied from a row when the column is not null.
 *
 * Wider than `OptionalJobField`: a transition may never write `startedAt`,
 * which is stamped once when the job is claimed.
 */
const DecodedJobField = {
  ...OptionalJobField,
  progressStep: "progressStep",
  progressSteps: "progressSteps",
  startedAt: "startedAt",
} as const;

/** Drizzle column modes spelled once instead of at every call site. */
const ColumnMode = {
  boolean: "boolean",
} as const;

/** Connection pragmas applied once when the durable file is opened. */
const DatabasePragma = {
  busyTimeout: "busy_timeout",
  foreignKeys: "foreign_keys",
  journalMode: "journal_mode",
  journalSizeLimit: "journal_size_limit",
  synchronous: "synchronous",
} as const;

/** Pragma values the platform requires. */
const DatabasePragmaValue = {
  foreignKeysOn: "ON",
  journalModeWal: "WAL",
  synchronousNormal: "NORMAL",
} as const;

/** SQL keywords the platform writes by hand outside the query builder. */
const SqlKeyword = {
  caseWhen: "CASE WHEN",
  elseBranch: "ELSE",
  end: "END",
  pragma: "PRAGMA",
  thenBranch: "THEN",
} as const;

/** SQLite pseudo-table exposing the conflicting row inside an upsert. */
const ExcludedRow: string = "excluded";

/** Operator-facing database failure messages. */
const DatabaseMessage = {
  bindRemoteJob: "binding remote engine job failed",
  claimQueuedJob: "claiming queued job failed",
  countQueuedJobs: "counting queued jobs failed",
  createStorageDirectory: "cannot create storage directory",
  insertQueuedJob: "inserting queued job failed",
  invalidStoredRequest: "stored job request is invalid JSON",
  invalidStoredStatus: "stored job status is invalid",
  listResults: "listing result metadata failed",
  listRunningJobs: "listing running jobs failed",
  openDatabase: "cannot open or migrate database",
  peekQueue: "reading queue head failed",
  ping: "database ping failed",
  readJob: "reading job failed",
  readQueueHead: "reading queue head failed",
  readResult: "reading result metadata failed",
  recordProgress: "recording job progress failed",
  renewLease: "renewing job lease failed",
  requestCancellation: "requesting cancellation failed",
  saveResults: "saving result metadata batch failed",
  staleStoredRequest: "stored job request violates the current schema",
  transitionJob: "transitioning job failed",
} as const;

export {
  ColumnMode,
  DatabaseMessage,
  DatabasePragma,
  DatabasePragmaValue,
  DatabaseSettings,
  DecodedJobField,
  ExcludedRow,
  IndexName,
  JobColumn,
  OptionalJobField,
  ResultColumn,
  SqlKeyword,
  TableName,
};
