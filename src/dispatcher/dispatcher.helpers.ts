import { Clock, Effect } from "effect";

import { MILLISECONDS_PER_SECOND } from "@app/time/time.constants.js";

/**
 * Calculates a future ISO lease deadline from the Effect clock.
 *
 * @param leaseSeconds - (number) Configured lease duration.
 * @returns (Effect.Effect<string>) ISO-8601 lease deadline.
 */
const createLeaseDeadline = (leaseSeconds: number): Effect.Effect<string> =>
  Clock.currentTimeMillis.pipe(
    Effect.map((nowEpochMs: number): string =>
      new Date(
        nowEpochMs + leaseSeconds * MILLISECONDS_PER_SECOND,
      ).toISOString(),
    ),
  );

export { createLeaseDeadline };
