import type { Database } from "bun:sqlite";
import type * as schema from "@app/infrastructure/database/database.schema";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";

/** Typed Drizzle database bound to the platform schema. */
type PlatformDatabase = BunSQLiteDatabase<typeof schema>;

/** Internal database adapter exposed only to repository implementations. */
interface DatabaseServiceShape {
  /** Raw handle, used only to close the connection when the scope ends. */
  readonly client: Database;
  readonly database: PlatformDatabase;
}

export type { DatabaseServiceShape, PlatformDatabase };
