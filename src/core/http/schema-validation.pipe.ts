import { InvalidRequestError } from "@app/core/errors/error.types";
import { mapPlatformErrorToHttp } from "@app/core/http/http-error.helpers";
import { SchemaParseOption } from "@app/core/runtime/runtime.constants";
import type { PipeTransform } from "@nestjs/common";
import { Either, type ParseResult, Schema } from "effect";

/** Decoder rejecting unknown members so payloads never carry silent extras. */
const StrictParseOptions = {
  onExcessProperty: SchemaParseOption.rejectExcessProperty,
} as const;

/**
 * Validates untrusted transport input against an Effect Schema at the boundary.
 *
 * Decoding is synchronous, so the pipe never needs the application runtime.
 */
class SchemaValidationPipe<A, I> implements PipeTransform<unknown, A> {
  readonly #decode: (
    input: unknown,
  ) => Either.Either<A, ParseResult.ParseError>;
  readonly #message: string;

  /**
   * Creates a boundary validator for one schema.
   *
   * @param {Schema.Schema<A, I>} schema - Schema describing the accepted input.
   * @param {string} message - Safe public message emitted on rejection.
   */
  constructor(schema: Schema.Schema<A, I>, message: string) {
    this.#decode = Schema.decodeUnknownEither(schema, StrictParseOptions);
    this.#message = message;
  }

  /**
   * Decodes one untrusted value or rejects it as a public bad request.
   *
   * @param {unknown} value - Untrusted body or route parameter.
   * @returns {A} Decoded value carrying the schema's type.
   */
  transform(value: unknown): A {
    const result: Either.Either<A, ParseResult.ParseError> =
      this.#decode(value);
    if (Either.isLeft(result)) {
      throw mapPlatformErrorToHttp(
        new InvalidRequestError({ message: this.#message }),
      );
    }
    return result.right;
  }
}

export { SchemaValidationPipe };
