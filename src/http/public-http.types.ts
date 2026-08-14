import { HttpException } from "@nestjs/common";

import type { PublicErrorResponse } from "@app/http/http.types.js";

/** HttpException carrying a stable response and optional Retry-After metadata. */
class PublicHttpException extends HttpException {
  readonly #response: PublicErrorResponse;
  readonly #retryAfterSeconds: number | undefined;

  /**
   * Creates one safe public HTTP exception.
   *
   * @param response - (PublicErrorResponse) Stable error body.
   * @param statusCode - (number) HTTP status code.
   */
  constructor(response: PublicErrorResponse, statusCode: number) {
    super(response, statusCode);
    this.#response = response;
    this.#retryAfterSeconds = response.retryAfterSeconds;
  }

  /**
   * Reads the stable typed public response body.
   *
   * @returns (PublicErrorResponse) Stable public error response.
   */
  override getResponse(): PublicErrorResponse {
    return this.#response;
  }

  /**
   * Reads optional Retry-After metadata.
   *
   * @returns (number | undefined) Retry delay in seconds when applicable.
   */
  getRetryAfterSeconds(): number | undefined {
    return this.#retryAfterSeconds;
  }
}

export { PublicHttpException };
