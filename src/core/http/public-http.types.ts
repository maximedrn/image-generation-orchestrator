import type { PublicErrorResponse } from "@app/core/http/http.types";
import { HttpException } from "@nestjs/common";

/** HttpException carrying a stable response and optional Retry-After metadata. */
class PublicHttpException extends HttpException {
  readonly #response: PublicErrorResponse;
  readonly #retryAfterSeconds: number | undefined;

  /**
   * Creates one safe public HTTP exception.
   *
   * @param {PublicErrorResponse} response - Stable error body.
   * @param {number} statusCode - HTTP status code.
   */
  constructor(response: PublicErrorResponse, statusCode: number) {
    super(response, statusCode);
    this.#response = response;
    this.#retryAfterSeconds = response.retryAfterSeconds;
  }

  /**
   * Reads the stable typed public response body.
   *
   * @returns {PublicErrorResponse} Stable public error response.
   */
  override getResponse(): PublicErrorResponse {
    return this.#response;
  }

  /**
   * Reads optional Retry-After metadata.
   *
   * @returns {Option.Option<number>} Retry delay in seconds when applicable.
   */
  getRetryAfterSeconds(): number | undefined {
    return this.#retryAfterSeconds;
  }
}

export { PublicHttpException };
