import { describe, expect, test } from "bun:test";
import { AuthMode } from "@app/core/config/config.constants";
import type { PlatformConfig } from "@app/core/config/config.types";
import type { UnauthorizedError } from "@app/core/errors/error.types";
import type { SecurityServiceShape } from "@app/core/security/security.interface";
import { createSecurityService } from "@app/core/security/security.service";
import { createPlatformConfigFixture } from "@test/fixtures/platform.fixture";
import { TestAuthorization, TestCaller } from "@test/fixtures/test.constants";
import { Effect, Either } from "effect";

describe("bearer authorization modes", (): void => {
  test("accepts every caller when authentication is disabled", async (): Promise<void> => {
    const base: PlatformConfig = createPlatformConfigFixture("/tmp/auth-none");
    const service: SecurityServiceShape = createSecurityService({
      ...base.security,
      auth: AuthMode.none,
    });
    await Effect.runPromise(service.authorize(undefined));
    expect(true).toBe(true);
  });

  test("rejects a valid scheme carrying the wrong secret", async (): Promise<void> => {
    const base: PlatformConfig = createPlatformConfigFixture("/tmp/auth-wrong");
    const service: SecurityServiceShape = createSecurityService(base.security);
    const outcome: Either.Either<void, UnauthorizedError> =
      await Effect.runPromise(
        Effect.either(service.authorize(TestAuthorization.bearerWrongSecret)),
      );
    expect(Either.isLeft(outcome)).toBe(true);
  });

  test("accepts the configured secret", async (): Promise<void> => {
    const base: PlatformConfig = createPlatformConfigFixture("/tmp/auth-ok");
    const service: SecurityServiceShape = createSecurityService(base.security);
    await Effect.runPromise(service.authorize(TestCaller.bearerHeader));
    expect(true).toBe(true);
  });
});
