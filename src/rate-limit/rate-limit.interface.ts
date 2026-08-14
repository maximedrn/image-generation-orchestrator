import type { Effect } from "effect";

import type { RateLimitedError } from "@app/error/error.types.js";

/** Local overload-protection port keyed by a caller identity. */
interface RateLimiterShape {
  readonly consume: (
    key: string,
  ) => Effect.Effect<void, RateLimitedError>;
}

export type { RateLimiterShape };
