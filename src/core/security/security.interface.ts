import type {
  RateLimitedError,
  UnauthorizedError,
} from "@app/core/errors/error.types";
import type { Effect } from "effect";

/** Authentication port used by NestJS guards. */
interface SecurityServiceShape {
  readonly authorize: (
    authorizationHeader: string | undefined,
  ) => Effect.Effect<void, UnauthorizedError>;
}

/** Local overload-protection port keyed by a caller identity. */
interface RateLimiterShape {
  readonly consume: (key: string) => Effect.Effect<void, RateLimitedError>;
}

export type { RateLimiterShape, SecurityServiceShape };
