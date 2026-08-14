/** SQLite file name inside the configured storage root. */
const DATABASE_FILE_NAME = "app.sqlite";

/** SQLite busy timeout avoids immediate failure under short write contention. */
const DATABASE_BUSY_TIMEOUT_MS = 5000;

/** WAL journal size cap keeps durable metadata storage bounded. */
const DATABASE_JOURNAL_SIZE_LIMIT_BYTES = 64 * 1024 * 1024;

/** First version number assigned to the first ordered migration. */
const DATABASE_FIRST_MIGRATION_VERSION = 1;

/** Integer booleans persisted by SQLite. */
const DATABASE_BOOLEAN = {
  FALSE: 0,
  TRUE: 1,
} as const;

/** Schema migration table bootstrap statement. */
const DATABASE_MIGRATION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

/** Ordered idempotent database migrations, including upgrade from legacy lot 2. */
const DATABASE_MIGRATIONS: readonly string[] = [
  `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  cost INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  engine_id TEXT,
  remote_job_id TEXT,
  lease_until TEXT,
  error_code TEXT,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS results (
  job_id TEXT NOT NULL,
  "index" INTEGER NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  PRIMARY KEY (job_id, "index")
);
`,
  `
ALTER TABLE jobs ADD COLUMN model TEXT;
ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
UPDATE jobs
SET model = json_extract(request_json, '$.model')
WHERE model IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_queue
ON jobs(status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_jobs_running_lease
ON jobs(status, lease_until);
CREATE INDEX IF NOT EXISTS idx_jobs_model_status
ON jobs(model, status);
`,
];

export {
  DATABASE_BUSY_TIMEOUT_MS,
  DATABASE_BOOLEAN,
  DATABASE_FILE_NAME,
  DATABASE_FIRST_MIGRATION_VERSION,
  DATABASE_JOURNAL_SIZE_LIMIT_BYTES,
  DATABASE_MIGRATIONS,
  DATABASE_MIGRATION_TABLE_SQL,
};
