import { describe, expect, test } from "bun:test";
import { Effect, Either, Ref } from "effect";

import type { RateLimitedError } from "@app/error/error.types.js";
import type { RateLimiterShape } from "@app/rate-limit/rate-limit.interface.js";
import { createRateLimiter } from "@app/rate-limit/rate-limit.service.js";
import type { RateLimitBucket } from "@app/rate-limit/rate-limit.types.js";

describe("rate limiter", (): void => {
  test("rejects requests after the configured window capacity", async (): Promise<void> => {
    const effect: Effect.Effect<Either.Either<void, RateLimitedError>> =
      Effect.gen(function* rateLimitTestEffect(): Generator<
        unknown,
        Either.Either<void, RateLimitedError>
      > {
        const state: Ref.Ref<ReadonlyMap<string, RateLimitBucket>> =
          yield* Ref.make<ReadonlyMap<string, RateLimitBucket>>(
            new Map<string, RateLimitBucket>(),
          );
        const limiter: RateLimiterShape = createRateLimiter(
          { maxRequests: 1, maxTrackedClients: 10, windowSeconds: 60 },
          state,
        );
        yield* limiter.consume("client-a");
        return yield* Effect.either(limiter.consume("client-a"));
      });
    const result: Either.Either<void, RateLimitedError> =
      await Effect.runPromise(effect);
    expect(result._tag).toBe("Left");
  });

  test("never retains more client buckets than the configured RAM bound", async (): Promise<void> => {
    const state: Ref.Ref<ReadonlyMap<string, RateLimitBucket>> =
      await Effect.runPromise(
        Ref.make<ReadonlyMap<string, RateLimitBucket>>(
          new Map<string, RateLimitBucket>(),
        ),
      );
    const limiter: RateLimiterShape = createRateLimiter(
      { maxRequests: 10, maxTrackedClients: 1, windowSeconds: 60 },
      state,
    );
    await Effect.runPromise(limiter.consume("client-a"));
    await Effect.runPromise(limiter.consume("client-b"));
    const buckets: ReadonlyMap<string, RateLimitBucket> =
      await Effect.runPromise(Ref.get(state));
    expect(buckets.size).toBe(1);
    expect(buckets.has("client-b")).toBe(true);
  });

});
