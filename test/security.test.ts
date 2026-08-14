import { describe, expect, test } from "bun:test";
import { Effect, Either } from "effect";

import { AUTH_MODE } from "@app/config/config.constants.js";
import type { UnauthorizedError } from "@app/error/error.types.js";
import type { SecurityServiceShape } from "@app/security/security.interface.js";
import { constantTimeSecretEquals, createSecurityService, extractBearerToken } from "@app/security/security.service.js";

describe("security service", (): void => {
  test("parses only the Bearer scheme", (): void => {
    expect(extractBearerToken("Bearer secret")).toBe("secret");
    expect(extractBearerToken("Basic secret")).toBeUndefined();
  });

  test("compares hashed fixed-length values", (): void => {
    expect(constantTimeSecretEquals("secret", "secret")).toBe(true);
    expect(constantTimeSecretEquals("secret", "different")).toBe(false);
  });

  test("returns an explicit unauthorized error", async (): Promise<void> => {
    const service: SecurityServiceShape = createSecurityService({
      apiKey: "secret",
      auth: AUTH_MODE.BEARER,
    });
    const result: Either.Either<void, UnauthorizedError> = await Effect.runPromise(
      Effect.either(service.authorize("Bearer wrong")),
    );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("UnauthorizedError");
    }
  });
});
