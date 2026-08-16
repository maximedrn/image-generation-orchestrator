import { describe, expect, test } from "bun:test";
import type { RateLimitedError } from "@app/core/errors/error.types";
import { createRateLimiter } from "@app/core/security/rate-limit.service";
import type { RateLimiterShape } from "@app/core/security/security.interface";
import { TestCaller } from "@test/fixtures/test.constants";
import { Effect, Either } from "effect";

describe("rate limiter", (): void => {
  test("rejects requests after the configured window capacity", async (): Promise<void> => {
    const result: Either.Either<void, RateLimitedError> =
      await Effect.runPromise(
        Effect.gen(function* rateLimitCapacityEffect() {
          const limiter: RateLimiterShape = yield* createRateLimiter({
            maxRequests: 1,
            maxTrackedClients: 10,
            windowSeconds: 60,
          });
          yield* limiter.consume(TestCaller.rateLimitKey);
          return yield* Effect.either(limiter.consume(TestCaller.rateLimitKey));
        }),
      );
    expect(Either.isLeft(result)).toBe(true);
  });

  test("reports a usable Retry-After when a window is exhausted", async (): Promise<void> => {
    const result: Either.Either<void, RateLimitedError> =
      await Effect.runPromise(
        Effect.gen(function* rateLimitRetryAfterEffect() {
          const limiter: RateLimiterShape = yield* createRateLimiter({
            maxRequests: 1,
            maxTrackedClients: 10,
            windowSeconds: 30,
          });
          yield* limiter.consume(TestCaller.rateLimitKey);
          return yield* Effect.either(limiter.consume(TestCaller.rateLimitKey));
        }),
      );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.left.retryAfterSeconds).toBeLessThanOrEqual(30);
    }
  });

  test("keeps distinct clients in independent windows", async (): Promise<void> => {
    const result: Either.Either<void, RateLimitedError> =
      await Effect.runPromise(
        Effect.gen(function* rateLimitIsolationEffect() {
          const limiter: RateLimiterShape = yield* createRateLimiter({
            maxRequests: 1,
            maxTrackedClients: 10,
            windowSeconds: 60,
          });
          yield* limiter.consume(TestCaller.rateLimitKey);
          return yield* Effect.either(limiter.consume("client-b"));
        }),
      );
    expect(Either.isRight(result)).toBe(true);
  });
});
