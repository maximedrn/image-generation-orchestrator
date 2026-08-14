import { Database, type SQLQueryBindings } from "bun:sqlite";
import { FileSystem } from "@effect/platform/FileSystem";
import { Context, Effect, Layer } from "effect";

import { EFFECT_SERVICE_IDENTIFIER } from "@app/runtime/runtime.constants.js";
import { ConfigService } from "@app/config/config.service.js";
import type { PlatformConfig } from "@app/config/config.types.js";
import {
  DATABASE_BUSY_TIMEOUT_MS,
  DATABASE_FILE_NAME,
  DATABASE_FIRST_MIGRATION_VERSION,
  DATABASE_JOURNAL_SIZE_LIMIT_BYTES,
  DATABASE_MIGRATIONS,
  DATABASE_MIGRATION_TABLE_SQL,
} from "@app/database/database.constants.js";
import type { DatabaseServiceShape } from "@app/database/database.interface.js";
import { DatabaseError } from "@app/error/error.types.js";

/** Effect Context tag for the scoped SQLite connection. */
class DatabaseService extends Context.Tag(EFFECT_SERVICE_IDENTIFIER.DATABASE)<
  DatabaseService,
  DatabaseServiceShape
>() {}

/**
 * Applies all missing ordered migrations inside explicit transactions.
 *
 * @param database - (Database) Open Bun SQLite database.
 * @returns (void) Returns after the schema is current.
 */
const runMigrations = (database: Database): void => {
  database.exec(DATABASE_MIGRATION_TABLE_SQL);
  const rows: readonly { readonly version: number }[] = database
    .query<{ version: number }, SQLQueryBindings[]>(
      "SELECT version FROM schema_migrations ORDER BY version ASC",
    )
    .all();
  const appliedVersions: ReadonlySet<number> = new Set<number>(
    rows.map((row: { readonly version: number }): number => row.version),
  );
  DATABASE_MIGRATIONS.forEach((sql: string, migrationIndex: number): void => {
    const version: number = migrationIndex + DATABASE_FIRST_MIGRATION_VERSION;
    if (appliedVersions.has(version)) {
      return;
    }
    const applyMigration: () => void = database.transaction((): void => {
      database.exec(sql);
      database.run(
        "INSERT INTO schema_migrations (version, applied_at) VALUES (?, CURRENT_TIMESTAMP)",
        [version],
      );
    });
    applyMigration();
  });
};

/**
 * Opens and configures the durable SQLite database.
 *
 * @param config - (PlatformConfig) Resolved platform configuration.
 * @returns (Database) Open configured SQLite connection.
 */
const openDatabase = (config: PlatformConfig): Database => {
  const databasePath: string = `${config.storage.root}/${DATABASE_FILE_NAME}`;
  const database: Database = new Database(databasePath, { strict: true });
  database.run(`PRAGMA busy_timeout = ${DATABASE_BUSY_TIMEOUT_MS}`);
  database.run("PRAGMA foreign_keys = ON");
  database.run(`PRAGMA journal_size_limit = ${DATABASE_JOURNAL_SIZE_LIMIT_BYTES}`);
  database.run("PRAGMA journal_mode = WAL");
  database.run("PRAGMA synchronous = NORMAL");
  runMigrations(database);
  return database;
};

/**
 * Creates the database service object around an already-open connection.
 *
 * @param database - (Database) Open Bun SQLite connection.
 * @returns (DatabaseServiceShape) Effectful adapter consumed by repositories.
 */
const createDatabaseService = (database: Database): DatabaseServiceShape => ({
  ping: Effect.try({
    catch: (cause: unknown): DatabaseError =>
      new DatabaseError({ cause, message: "database ping failed" }),
    try: (): void => {
      database.query("SELECT 1 AS ok").get();
    },
  }),
  sqlite: database,
});

/** Scoped live database layer with deterministic acquisition and release. */
const DatabaseServiceLive: Layer.Layer<
  DatabaseService,
  DatabaseError,
  ConfigService | FileSystem
> = Layer.scoped(
  DatabaseService,
  Effect.gen(function* databaseLayerEffect(): Generator<unknown, DatabaseServiceShape> {
    const config: PlatformConfig = yield* ConfigService;
    const fileSystem: FileSystem = yield* FileSystem;
    yield* fileSystem.makeDirectory(config.storage.root, { recursive: true }).pipe(
      Effect.mapError(
        (cause: unknown): DatabaseError =>
          new DatabaseError({
            cause,
            message: `cannot create storage directory: ${config.storage.root}`,
          }),
      ),
    );
    const database: Database = yield* Effect.try({
      catch: (cause: unknown): DatabaseError =>
        new DatabaseError({ cause, message: "cannot open or migrate database" }),
      try: (): Database => openDatabase(config),
    });
    yield* Effect.addFinalizer((): Effect.Effect<void> =>
      Effect.sync((): void => database.close()),
    );
    return createDatabaseService(database);
  }),
);

export { DatabaseService, DatabaseServiceLive, openDatabase, runMigrations };
