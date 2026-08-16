import { describe, expect, test } from "bun:test";
import { AuthMode } from "@app/core/config/config.constants";
import type { PlatformConfig } from "@app/core/config/config.types";
import type { UnauthorizedError } from "@app/core/errors/error.types";
import type { SecurityServiceShape } from "@app/core/security/security.interface";
import { createSecurityService } from "@app/core/security/security.service";
import { createPlatformConfigFixture } from "@test/fixtures/platform.fixture";
import { TestAuthorization } from "@test/fixtures/test.constants";
import { Effect, Either } from "effect";

describe("bearer token extraction", (): void => {
  test("rejects a missing or non-bearer authorization header", async (): Promise<void> => {
    const base: PlatformConfig =
      createPlatformConfigFixture("/tmp/auth-none-hdr");
    const service: SecurityServiceShape = createSecurityService({
      ...base.security,
      auth: AuthMode.bearer,
    });
    for (const header of [undefined, TestAuthorization.basic, "test-secret"]) {
      const outcome: Either.Either<void, UnauthorizedError> =
        await Effect.runPromise(Effect.either(service.authorize(header)));
      expect(Either.isLeft(outcome)).toBe(true);
    }
  });
});
