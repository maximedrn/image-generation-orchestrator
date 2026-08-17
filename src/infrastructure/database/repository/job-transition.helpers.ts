import { OptionalJobField } from "@app/infrastructure/database/database.constants";
import type { jobs } from "@app/infrastructure/database/database.schema";
import type {
  JobTransition,
  JobTransitionChanges,
} from "@app/modules/jobs/job.types";
import { Option } from "effect";

/** Partial SET clause accepted by a Drizzle update on the jobs table. */
type JobUpdate = Partial<typeof jobs.$inferInsert>;

/** Nullable text columns a transition may replace. */
type NullableJobColumn =
  (typeof OptionalJobField)[keyof typeof OptionalJobField];

/** Transition fields mapped one-to-one onto nullable job columns. */
const nullableColumns: readonly NullableJobColumn[] = [
  OptionalJobField.engineId,
  OptionalJobField.errorCode,
  OptionalJobField.errorMessage,
  OptionalJobField.leaseUntil,
  OptionalJobField.remoteJobId,
];

/**
 * Includes one nullable column in the SET clause only when the caller set it.
 *
 * An absent field leaves the column untouched, while an explicit `null` clears
 * it — the distinction the previous conditional SQL had to emulate by hand.
 *
 * @param {JobTransitionChanges} changes - Requested metadata changes.
 * @param {NullableJobColumn} column - Column to consider.
 * @returns {JobUpdate} Empty object or a single-column patch.
 */
const nullableUpdate = (
  changes: JobTransitionChanges,
  column: NullableJobColumn,
): JobUpdate =>
  Object.hasOwn(changes, column) ? { [column]: changes[column] ?? null } : {};

/**
 * Builds the SET clause of one validated job transition.
 *
 * @param {JobTransition} transition - Requested domain transition.
 * @param {string} nowIso - Effect-clock timestamp supplied by the adapter.
 * @returns {JobUpdate} Partial update applied by Drizzle.
 */
const toJobUpdate = (transition: JobTransition, nowIso: string): JobUpdate => ({
  ...Object.assign(
    {},
    ...nullableColumns.map(
      (column: NullableJobColumn): JobUpdate =>
        nullableUpdate(transition.changes, column),
    ),
  ),
  ...Option.match(Option.fromNullable(transition.changes.cancelRequested), {
    onNone: (): JobUpdate => ({}),
    onSome: (cancelRequested: boolean): JobUpdate => ({ cancelRequested }),
  }),
  status: transition.to,
  updatedAt: nowIso,
});

export type { JobUpdate, NullableJobColumn };
export { nullableUpdate, toJobUpdate };
