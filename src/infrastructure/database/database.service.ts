import { Database } from "bun:sqlite";
import { ConfigService } from "@app/core/config/config.service";
import type { PlatformConfig } from "@app/core/config/config.types";
import { DatabaseError } from "@app/core/errors/error.types";
import { ServiceTag } from "@app/core/runtime/service.constants";
import {
  DatabaseMessage,
  DatabasePragma,
  DatabasePragmaValue,
  DatabaseSettings,
  SqlKeyword,
} from "@app/infrastructure/database/database.constants";
import * as schema from "@app/infrastructure/database/database.schema";
import type {
  DatabaseServiceShape,
  PlatformDatabase,
} from "@app/infrastructure/database/database.types";
import { FileSystem } from "@effect/platform/FileSystem";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Effect } from "effect";

/**
 * Opens the durable SQLite file and brings its schema up to date.
 *
 * The pragmas are connection settings rather than queries; every statement that
 * touches data goes through the Drizzle query builder.
 *
 * @param {PlatformConfig} config - Resolved platform configuration.
 * @returns {DatabaseServiceShape} Migrated, typed Drizzle database and its client.
 */
const openDatabase = (config: PlatformConfig): DatabaseServiceShape => {
  const client: Database = new Database(
    `${config.storage.root}/${DatabaseSettings.fileName}`,
    { strict: true },
  );
  const database: PlatformDatabase = drizzle({ client, schema });
  database.run(
    sql`${sql.raw(SqlKeyword.pragma)} ${sql.raw(DatabasePragma.busyTimeout)} = ${sql.raw(String(DatabaseSettings.busyTimeoutMs))}`,
  );
  database.run(
    sql`${sql.raw(SqlKeyword.pragma)} ${sql.raw(DatabasePragma.foreignKeys)} = ${sql.raw(DatabasePragmaValue.foreignKeysOn)}`,
  );
  database.run(
    sql`${sql.raw(SqlKeyword.pragma)} ${sql.raw(DatabasePragma.journalSizeLimit)} = ${sql.raw(String(DatabaseSettings.journalSizeLimitBytes))}`,
  );
  database.run(
    sql`${sql.raw(SqlKeyword.pragma)} ${sql.raw(DatabasePragma.journalMode)} = ${sql.raw(DatabasePragmaValue.journalModeWal)}`,
  );
  database.run(
    sql`${sql.raw(SqlKeyword.pragma)} ${sql.raw(DatabasePragma.synchronous)} = ${sql.raw(DatabasePragmaValue.synchronousNormal)}`,
  );
  migrate(database, { migrationsFolder: DatabaseSettings.migrationsFolder });
  return { client, database };
};

/** Scoped, migrated SQLite connection shared by every repository. */
class DatabaseService extends Effect.Service<DatabaseService>()(
  ServiceTag.databaseService,
  {
    scoped: Effect.gen(function* databaseService() {
      const config: PlatformConfig = yield* ConfigService;
      const fileSystem: FileSystem = yield* FileSystem;
      yield* fileSystem
        .makeDirectory(config.storage.root, { recursive: true })
        .pipe(
          Effect.mapError(
            (cause: unknown): DatabaseError =>
              new DatabaseError({
                cause,
                message: `${DatabaseMessage.createStorageDirectory}: ${config.storage.root}`,
              }),
          ),
        );
      return yield* Effect.acquireRelease(
        Effect.try({
          catch: (cause: unknown): DatabaseError =>
            new DatabaseError({
              cause,
              message: DatabaseMessage.openDatabase,
            }),
          try: (): DatabaseServiceShape => openDatabase(config),
        }),
        (open: DatabaseServiceShape): Effect.Effect<void> =>
          Effect.sync((): void => {
            open.client.close();
          }),
      );
    }),
  },
) {}

export { DatabaseService, openDatabase };
