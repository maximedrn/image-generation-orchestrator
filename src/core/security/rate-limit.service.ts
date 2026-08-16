import { ConfigService } from "@app/core/config/config.service";
import type {
  PlatformConfig,
  RateLimitConfig,
} from "@app/core/config/config.types";
import { RateLimitedError } from "@app/core/errors/error.types";
import { ServiceTag } from "@app/core/runtime/service.constants";
import { RateLimitPolicy } from "@app/core/security/security.constants";
import type { RateLimiterShape } from "@app/core/security/security.interface";
import { Cache, Clock, Duration, Effect, Ref } from "effect";

/** One bounded fixed-window counter owned by a single client key. */
interface RateLimitWindow {
  readonly count: number;
  readonly endsAtEpochMs: number;
}

/** Per-key window state cached under an explicit capacity and time-to-live. */
type RateLimitCache = Cache.Cache<string, Ref.Ref<RateLimitWindow>>;

/**
 * Converts a remaining window into a client-usable Retry-After value.
 *
 * @param {RateLimitWindow} window - Current fixed window.
 * @param {number} nowEpochMs - Current wall-clock time.
 * @returns {number} Retry delay in whole seconds, never below one.
 */
const retryAfterSeconds = (
  window: RateLimitWindow,
  nowEpochMs: number,
): number =>
  Math.max(
    RateLimitPolicy.minimumRetryAfterSeconds,
    Math.ceil(
      Duration.toSeconds(Duration.millis(window.endsAtEpochMs - nowEpochMs)),
    ),
  );

/**
 * Consumes one request slot from a client window, rolling it over when expired.
 *
 * `Cache` bounds the number of tracked clients and drops idle entries, so this
 * only has to own the counting inside one live window.
 *
 * @param {Ref.Ref<RateLimitWindow>} windowRef - Cached window for one client.
 * @param {RateLimitConfig} config - Configured window size and request budget.
 * @param {number} nowEpochMs - Current wall-clock time.
 * @returns {Effect.Effect<void, RateLimitedError>} Admission decision.
 */
const consumeWindow = (
  windowRef: Ref.Ref<RateLimitWindow>,
  config: RateLimitConfig,
  nowEpochMs: number,
): Effect.Effect<void, RateLimitedError> =>
  Ref.modify(
    windowRef,
    (current: RateLimitWindow): readonly [RateLimitWindow, RateLimitWindow] => {
      const window: RateLimitWindow =
        current.endsAtEpochMs > nowEpochMs
          ? current
          : {
              count: 0,
              endsAtEpochMs:
                nowEpochMs +
                Duration.toMillis(Duration.seconds(config.windowSeconds)),
            };
      const next: RateLimitWindow = { ...window, count: window.count + 1 };
      return [next, next];
    },
  ).pipe(
    Effect.flatMap(
      (window: RateLimitWindow): Effect.Effect<void, RateLimitedError> =>
        window.count > config.maxRequests
          ? Effect.fail(
              new RateLimitedError({
                message: RateLimitPolicy.rejectedMessage,
                retryAfterSeconds: retryAfterSeconds(window, nowEpochMs),
              }),
            )
          : Effect.void,
    ),
  );

/**
 * Builds the bounded per-client rate limiter over an Effect cache.
 *
 * @param {RateLimitConfig} config - Configured window size and request budget.
 * @returns {Effect.Effect<RateLimiterShape>} Bounded rate-limiting port.
 */
const createRateLimiter = (
  config: RateLimitConfig,
): Effect.Effect<RateLimiterShape> =>
  Cache.make<string, Ref.Ref<RateLimitWindow>>({
    capacity: config.maxTrackedClients,
    lookup: (_key: string): Effect.Effect<Ref.Ref<RateLimitWindow>> =>
      Ref.make<RateLimitWindow>({ count: 0, endsAtEpochMs: 0 }),
    timeToLive: Duration.seconds(config.windowSeconds),
  }).pipe(
    Effect.map(
      (cache: RateLimitCache): RateLimiterShape => ({
        consume: (key: string): Effect.Effect<void, RateLimitedError> =>
          Effect.all([cache.get(key), Clock.currentTimeMillis]).pipe(
            Effect.flatMap(
              ([windowRef, nowEpochMs]: readonly [
                Ref.Ref<RateLimitWindow>,
                number,
              ]): Effect.Effect<void, RateLimitedError> =>
                consumeWindow(windowRef, config, nowEpochMs),
            ),
          ),
      }),
    ),
  );

/** Bounded local overload protection keyed by caller identity. */
class RateLimiter extends Effect.Service<RateLimiter>()(
  ServiceTag.rateLimiter,
  {
    effect: ConfigService.pipe(
      Effect.flatMap(
        (config: PlatformConfig): Effect.Effect<RateLimiterShape> =>
          createRateLimiter(config.rateLimit),
      ),
    ),
  },
) {}

export type { RateLimitWindow };
export { consumeWindow, createRateLimiter, RateLimiter, retryAfterSeconds };
