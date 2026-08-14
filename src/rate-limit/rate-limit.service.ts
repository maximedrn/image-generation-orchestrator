import { Clock, Context, Effect, Layer, Ref } from "effect";

import { ConfigService } from "@app/config/config.service.js";
import type { PlatformConfig, RateLimitConfig } from "@app/config/config.types.js";
import { RateLimitedError } from "@app/error/error.types.js";
import type { RateLimiterShape } from "@app/rate-limit/rate-limit.interface.js";
import type { RateLimitBucket } from "@app/rate-limit/rate-limit.types.js";
import { EFFECT_SERVICE_IDENTIFIER } from "@app/runtime/runtime.constants.js";
import { MILLISECONDS_PER_SECOND } from "@app/time/time.constants.js";

/** Minimum Retry-After value accepted by HTTP clients. */
const MINIMUM_RETRY_AFTER_SECONDS = 1;

/** Effect Context tag for bounded local HTTP rate limiting. */
class RateLimiter extends Context.Tag(EFFECT_SERVICE_IDENTIFIER.RATE_LIMITER)<
  RateLimiter,
  RateLimiterShape
>() {}

/**
 * Drops expired buckets and, when necessary, oldest-expiring entries.
 *
 * @param buckets - (ReadonlyMap<string, RateLimitBucket>) Current counters.
 * @param nowEpochMs - (number) Current time.
 * @param maxTrackedClients - (number) Hard RAM bound for unique client keys.
 * @returns (Map<string, RateLimitBucket>) Bounded mutable copy.
 */
const compactBuckets = (
  buckets: ReadonlyMap<string, RateLimitBucket>,
  nowEpochMs: number,
  maxTrackedClients: number,
): Map<string, RateLimitBucket> => {
  const activeEntries: readonly (readonly [string, RateLimitBucket])[] = [
    ...buckets.entries(),
  ].filter(
    ([, bucket]: readonly [string, RateLimitBucket]): boolean =>
      bucket.windowEndsAtEpochMs > nowEpochMs,
  );
  const boundedEntries: readonly (readonly [string, RateLimitBucket])[] =
    activeEntries.length <= maxTrackedClients
      ? activeEntries
      : activeEntries
          .toSorted(
            (
              left: readonly [string, RateLimitBucket],
              right: readonly [string, RateLimitBucket],
            ): number =>
              right[1].windowEndsAtEpochMs - left[1].windowEndsAtEpochMs,
          )
          .slice(0, maxTrackedClients);
  return new Map<string, RateLimitBucket>(boundedEntries);
};

/**
 * Evicts one active bucket when a new client key would exceed the RAM bound.
 *
 * The bucket expiring soonest is discarded because it has the least remaining
 * lifetime. Existing keys are never evicted merely because they are consumed.
 *
 * @param buckets - (ReadonlyMap<string, RateLimitBucket>) Active bounded buckets.
 * @param key - (string) Client key about to be consumed.
 * @param maxTrackedClients - (number) Maximum number of retained client keys.
 * @returns (Map<string, RateLimitBucket>) Capacity-safe mutable bucket map.
 */
const ensureCapacityForKey = (
  buckets: ReadonlyMap<string, RateLimitBucket>,
  key: string,
  maxTrackedClients: number,
): Map<string, RateLimitBucket> => {
  const bounded: Map<string, RateLimitBucket> = new Map(buckets);
  if (bounded.has(key) || bounded.size < maxTrackedClients) {
    return bounded;
  }
  const candidate: readonly [string, RateLimitBucket] | undefined = [
    ...bounded.entries(),
  ].toSorted(
    (
      left: readonly [string, RateLimitBucket],
      right: readonly [string, RateLimitBucket],
    ): number =>
      left[1].windowEndsAtEpochMs === right[1].windowEndsAtEpochMs
        ? left[0].localeCompare(right[0])
        : left[1].windowEndsAtEpochMs - right[1].windowEndsAtEpochMs,
  )[0];
  if (candidate !== undefined) {
    bounded.delete(candidate[0]);
  }
  return bounded;
};

/**
 * Creates a fixed-window limiter whose state is bounded by configuration.
 *
 * @param config - (RateLimitConfig) Rate-limit settings.
 * @param bucketsRef - (Ref.Ref<ReadonlyMap<string, RateLimitBucket>>) State reference.
 * @returns (RateLimiterShape) Effectful limiter implementation.
 */
const createRateLimiter = (
  config: RateLimitConfig,
  bucketsRef: Ref.Ref<ReadonlyMap<string, RateLimitBucket>>,
): RateLimiterShape => ({
  consume: (key: string): Effect.Effect<void, RateLimitedError> =>
    Clock.currentTimeMillis.pipe(
      Effect.flatMap(
        (nowEpochMs: number): Effect.Effect<RateLimitedError | undefined> =>
          Ref.modify(
            bucketsRef,
            (
              currentBuckets: ReadonlyMap<string, RateLimitBucket>,
            ): readonly [
              RateLimitedError | undefined,
              ReadonlyMap<string, RateLimitBucket>,
            ] => {
              const buckets: Map<string, RateLimitBucket> = ensureCapacityForKey(
                compactBuckets(
                  currentBuckets,
                  nowEpochMs,
                  config.maxTrackedClients,
                ),
                key,
                config.maxTrackedClients,
              );
              const current: RateLimitBucket | undefined = buckets.get(key);
              const windowDurationMs: number =
                config.windowSeconds * MILLISECONDS_PER_SECOND;
              const bucket: RateLimitBucket =
                current === undefined || current.windowEndsAtEpochMs <= nowEpochMs
                  ? {
                      count: 0,
                      windowEndsAtEpochMs: nowEpochMs + windowDurationMs,
                    }
                  : current;
              if (bucket.count >= config.maxRequests) {
                const retryAfterSeconds: number = Math.max(
                  MINIMUM_RETRY_AFTER_SECONDS,
                  Math.ceil(
                    (bucket.windowEndsAtEpochMs - nowEpochMs) /
                      MILLISECONDS_PER_SECOND,
                  ),
                );
                return [
                  new RateLimitedError({
                    message: "request rate limit exceeded",
                    retryAfterSeconds,
                  }),
                  buckets,
                ] as const;
              }
              buckets.set(key, { ...bucket, count: bucket.count + 1 });
              return [undefined, buckets] as const;
            },
          ),
      ),
      Effect.flatMap(
        (
          error: RateLimitedError | undefined,
        ): Effect.Effect<void, RateLimitedError> =>
          error === undefined ? Effect.void : Effect.fail(error),
      ),
    ),
});

/** Live bounded rate-limiter layer. */
const RateLimiterLive: Layer.Layer<RateLimiter, never, ConfigService> = Layer.effect(
  RateLimiter,
  Effect.gen(function* rateLimiterLayerEffect(): Generator<
    unknown,
    RateLimiterShape
  > {
    const platformConfig: PlatformConfig = yield* ConfigService;
    const bucketsRef: Ref.Ref<ReadonlyMap<string, RateLimitBucket>> =
      yield* Ref.make<ReadonlyMap<string, RateLimitBucket>>(
        new Map<string, RateLimitBucket>(),
      );
    return createRateLimiter(platformConfig.rateLimit, bucketsRef);
  }),
);

export {
  compactBuckets,
  createRateLimiter,
  ensureCapacityForKey,
  RateLimiter,
  RateLimiterLive,
};
