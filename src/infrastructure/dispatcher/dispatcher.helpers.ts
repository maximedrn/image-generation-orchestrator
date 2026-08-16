import { DateTime, Duration, Effect } from "effect";

/**
 * Calculates a future ISO lease deadline from the Effect clock.
 *
 * @param {number} leaseSeconds - Configured lease duration.
 * @returns {Effect.Effect<string>} ISO-8601 lease deadline.
 */
const createLeaseDeadline = (leaseSeconds: number): Effect.Effect<string> =>
  DateTime.now.pipe(
    Effect.map((now: DateTime.Utc): string =>
      DateTime.formatIso(
        DateTime.addDuration(now, Duration.seconds(leaseSeconds)),
      ),
    ),
  );

export { createLeaseDeadline };
