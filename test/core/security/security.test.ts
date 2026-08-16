import { describe, expect, test } from "bun:test";
import { AuthMode } from "@app/core/config/config.constants";
import { ErrorTag } from "@app/core/errors/error.constants";
import type { UnauthorizedError } from "@app/core/errors/error.types";
import { BearerAuth } from "@app/core/security/security.constants";
import type { SecurityServiceShape } from "@app/core/security/security.interface";
import {
  constantTimeSecretEquals,
  createSecurityService,
  extractBearerToken,
} from "@app/core/security/security.service";
import { TestAuthorization, TestCaller } from "@test/fixtures/test.constants";
import { Effect, Either, Option } from "effect";

describe("security service", (): void => {
  test("parses only the Bearer scheme", (): void => {
    expect(
      Option.getOrNull(
        extractBearerToken(`${BearerAuth.prefix}${TestCaller.arbitrarySecret}`),
      ),
    ).toBe(TestCaller.arbitrarySecret);
    expect(Option.isNone(extractBearerToken(TestAuthorization.basic))).toBe(
      true,
    );
  });

  test("compares hashed fixed-length values", (): void => {
    expect(
      constantTimeSecretEquals(
        TestCaller.arbitrarySecret,
        TestCaller.arbitrarySecret,
      ),
    ).toBe(true);
    expect(
      constantTimeSecretEquals(TestCaller.arbitrarySecret, "different"),
    ).toBe(false);
  });

  test("returns an explicit unauthorized error", async (): Promise<void> => {
    const service: SecurityServiceShape = createSecurityService({
      apiKey: TestCaller.arbitrarySecret,
      auth: AuthMode.bearer,
    });
    const result: Either.Either<void, UnauthorizedError> =
      await Effect.runPromise(
        Effect.either(service.authorize(TestAuthorization.bearerWrongSecret)),
      );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(ErrorTag.unauthorized);
    }
  });
});
