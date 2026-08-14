import type { Effect } from "effect";

import type { UnauthorizedError } from "@app/error/error.types.js";

/** Authentication port used by NestJS guards. */
interface SecurityServiceShape {
  readonly authorize: (
    authorizationHeader: string | undefined,
  ) => Effect.Effect<void, UnauthorizedError>;
}

export type { SecurityServiceShape };
