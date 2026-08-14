import { describe, expect, test } from "bun:test";
import { Effect, Either } from "effect";

import type { InvalidRequestError } from "@app/error/error.types.js";
import { parseNonNegativeInteger } from "@app/http/http.helpers.js";

describe("HTTP helpers", (): void => {
  test("accepts zero and positive safe integers", async (): Promise<void> => {
    expect(await Effect.runPromise(parseNonNegativeInteger("0", "index"))).toBe(0);
    expect(await Effect.runPromise(parseNonNegativeInteger("42", "index"))).toBe(42);
  });

  test("rejects fractional and negative values explicitly", async (): Promise<void> => {
    const fractional: Either.Either<number, InvalidRequestError> =
      await Effect.runPromise(
        Effect.either(parseNonNegativeInteger("1.5", "index")),
      );
    const negative: Either.Either<number, InvalidRequestError> =
      await Effect.runPromise(
        Effect.either(parseNonNegativeInteger("-1", "index")),
      );
    expect(Either.isLeft(fractional)).toBe(true);
    expect(Either.isLeft(negative)).toBe(true);
  });
});
