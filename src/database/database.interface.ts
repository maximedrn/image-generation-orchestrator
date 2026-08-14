import type { Database } from "bun:sqlite";
import type { Effect } from "effect";

import type { DatabaseError } from "@app/error/error.types.js";

/** Internal database adapter exposed only to SQL repository implementations. */
interface DatabaseServiceShape {
  readonly ping: Effect.Effect<void, DatabaseError>;
  readonly sqlite: Database;
}

export type { DatabaseServiceShape };
