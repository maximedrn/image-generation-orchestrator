import type { Effect } from "effect";

/** Long-lived dispatcher port started once by the NestJS lifecycle bridge. */
interface DispatcherShape {
  readonly run: Effect.Effect<void>;
}

export type { DispatcherShape };
