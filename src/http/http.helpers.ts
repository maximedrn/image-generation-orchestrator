import { Effect } from "effect";

import { InvalidRequestError } from "@app/error/error.types.js";

/**
 * Parses a URL parameter as a non-negative safe integer.
 *
 * @param value - (string) Raw URL parameter.
 * @param fieldName - (string) Parameter name for safe error messages.
 * @returns (Effect.Effect<number, InvalidRequestError>) Parsed integer.
 */
const parseNonNegativeInteger = (
  value: string,
  fieldName: string,
): Effect.Effect<number, InvalidRequestError> => {
  const parsed: number = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? Effect.succeed(parsed)
    : Effect.fail(
        new InvalidRequestError({ message: `${fieldName} must be an integer` }),
      );
};

export { parseNonNegativeInteger };
