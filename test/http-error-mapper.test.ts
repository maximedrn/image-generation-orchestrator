import { describe, expect, test } from "bun:test";
import { HttpStatus } from "@nestjs/common";

import {
  ConfigError,
  DatabaseError,
  EngineProtocolError,
  EngineRejectedError,
  EngineUnavailableError,
  InvalidRequestError,
  JobNotCancellableError,
  JobNotFoundError,
  LimitExceededError,
  QueueFullError,
  RateLimitedError,
  StorageError,
  UnauthorizedError,
} from "@app/error/error.types.js";
import type { PlatformError } from "@app/error/error.types.js";
import {
  HTTP_ERROR_CODE,
  HTTP_ERROR_MESSAGE,
} from "@app/http/http.constants.js";
import { mapPlatformErrorToHttp } from "@app/http/http-error.helpers.js";
import type { PublicErrorResponse } from "@app/http/http.types.js";
import type { PublicHttpException } from "@app/http/public-http.types.js";
import { TEST_ENGINE_ID } from "@test/platform.fixture.js";

/** Safe request message expected to survive transport mapping. */
const SAFE_REQUEST_MESSAGE = "request violates a public constraint";

/** Retry delay used by overload mapping fixtures. */
const RETRY_AFTER_SECONDS = 7;

/** One exhaustive public error mapping expectation. */
interface ErrorMappingCase {
  readonly error: PlatformError;
  readonly expected: PublicErrorResponse;
  readonly name: string;
  readonly status: number;
}

/** Complete mapping matrix for every current PlatformError discriminant. */
const ERROR_MAPPING_CASES: readonly ErrorMappingCase[] = [
  {
    error: new ConfigError({ message: "private configuration details" }),
    expected: {
      code: HTTP_ERROR_CODE.CONFIGURATION,
      message: HTTP_ERROR_MESSAGE.CONFIGURATION,
    },
    name: "redacts configuration failures",
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  {
    error: new DatabaseError({
      cause: new Error("sqlite secret path"),
      message: "cannot open /private/database.sqlite",
    }),
    expected: {
      code: HTTP_ERROR_CODE.DATABASE_UNAVAILABLE,
      message: HTTP_ERROR_MESSAGE.DATABASE_UNAVAILABLE,
    },
    name: "redacts database failures",
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  {
    error: new EngineProtocolError({
      engineId: TEST_ENGINE_ID,
      message: "private malformed payload details",
    }),
    expected: {
      code: HTTP_ERROR_CODE.ENGINE_PROTOCOL,
      message: HTTP_ERROR_MESSAGE.ENGINE_PROTOCOL,
    },
    name: "redacts engine protocol failures",
    status: HttpStatus.BAD_GATEWAY,
  },
  {
    error: new EngineRejectedError({
      engineId: TEST_ENGINE_ID,
      message: "private rejection body",
      statusCode: HttpStatus.BAD_REQUEST,
    }),
    expected: {
      code: HTTP_ERROR_CODE.ENGINE_REJECTED,
      message: HTTP_ERROR_MESSAGE.ENGINE_REJECTED,
    },
    name: "redacts engine rejections",
    status: HttpStatus.BAD_GATEWAY,
  },
  {
    error: new EngineUnavailableError({
      engineId: TEST_ENGINE_ID,
      message: "private network details",
    }),
    expected: {
      code: HTTP_ERROR_CODE.ENGINE_UNAVAILABLE,
      message: HTTP_ERROR_MESSAGE.ENGINE_UNAVAILABLE,
    },
    name: "redacts engine availability failures",
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  {
    error: new StorageError({ message: "private result path" }),
    expected: {
      code: HTTP_ERROR_CODE.STORAGE_UNAVAILABLE,
      message: HTTP_ERROR_MESSAGE.STORAGE_UNAVAILABLE,
    },
    name: "redacts result storage failures",
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  {
    error: new InvalidRequestError({ message: SAFE_REQUEST_MESSAGE }),
    expected: {
      code: HTTP_ERROR_CODE.INVALID_REQUEST,
      message: SAFE_REQUEST_MESSAGE,
    },
    name: "preserves safe invalid request messages",
    status: HttpStatus.BAD_REQUEST,
  },
  {
    error: new JobNotCancellableError({
      id: "terminal-job",
      message: SAFE_REQUEST_MESSAGE,
    }),
    expected: {
      code: HTTP_ERROR_CODE.JOB_NOT_CANCELLABLE,
      message: SAFE_REQUEST_MESSAGE,
    },
    name: "maps terminal cancellation conflicts",
    status: HttpStatus.CONFLICT,
  },
  {
    error: new JobNotFoundError({ id: "missing-job" }),
    expected: {
      code: HTTP_ERROR_CODE.JOB_NOT_FOUND,
      message: HTTP_ERROR_MESSAGE.JOB_NOT_FOUND,
    },
    name: "normalizes job not found failures",
    status: HttpStatus.NOT_FOUND,
  },
  {
    error: new LimitExceededError({
      limit: "maxPixels",
      message: SAFE_REQUEST_MESSAGE,
    }),
    expected: {
      code: HTTP_ERROR_CODE.LIMIT_EXCEEDED,
      message: SAFE_REQUEST_MESSAGE,
    },
    name: "maps configured request limits",
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  },
  {
    error: new QueueFullError({
      message: SAFE_REQUEST_MESSAGE,
      retryAfterSeconds: RETRY_AFTER_SECONDS,
    }),
    expected: {
      code: HTTP_ERROR_CODE.QUEUE_FULL,
      message: SAFE_REQUEST_MESSAGE,
      retryAfterSeconds: RETRY_AFTER_SECONDS,
    },
    name: "maps queue overload with retry metadata",
    status: HttpStatus.TOO_MANY_REQUESTS,
  },
  {
    error: new RateLimitedError({
      message: SAFE_REQUEST_MESSAGE,
      retryAfterSeconds: RETRY_AFTER_SECONDS,
    }),
    expected: {
      code: HTTP_ERROR_CODE.RATE_LIMITED,
      message: SAFE_REQUEST_MESSAGE,
      retryAfterSeconds: RETRY_AFTER_SECONDS,
    },
    name: "maps local rate limiting with retry metadata",
    status: HttpStatus.TOO_MANY_REQUESTS,
  },
  {
    error: new UnauthorizedError({ message: "private token mismatch detail" }),
    expected: {
      code: HTTP_ERROR_CODE.UNAUTHORIZED,
      message: HTTP_ERROR_MESSAGE.UNAUTHORIZED,
    },
    name: "normalizes authentication failures",
    status: HttpStatus.UNAUTHORIZED,
  },
];

/**
 * Reads a mapped HTTP error response through NestJS' public exception contract.
 *
 * @param exception - (PublicHttpException) Mapped safe transport exception.
 * @returns (PublicErrorResponse) Structured public error body.
 */
const readResponse = (exception: PublicHttpException): PublicErrorResponse =>
  exception.getResponse();

describe("HTTP error mapper", (): void => {
  ERROR_MAPPING_CASES.forEach((mappingCase: ErrorMappingCase): void => {
    test(mappingCase.name, (): void => {
      const exception: PublicHttpException = mapPlatformErrorToHttp(
        mappingCase.error,
      );
      expect(exception.getStatus()).toBe(mappingCase.status);
      expect(readResponse(exception)).toEqual(mappingCase.expected);
      if (mappingCase.expected.retryAfterSeconds !== undefined) {
        expect(exception.getRetryAfterSeconds()).toBe(
          mappingCase.expected.retryAfterSeconds,
        );
      }
    });
  });
});
