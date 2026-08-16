import { describe, expect, test } from "bun:test";
import type { PlatformError } from "@app/core/errors/error.types";
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
} from "@app/core/errors/error.types";
import { HttpErrorCode, HttpErrorMessage } from "@app/core/http/http.constants";
import type { PublicErrorResponse } from "@app/core/http/http.types";
import { mapPlatformErrorToHttp } from "@app/core/http/http-error.helpers";
import type { PublicHttpException } from "@app/core/http/public-http.types";
import { JobLimitName } from "@app/modules/jobs/job.constants";
import { HttpStatus } from "@nestjs/common";
import { TestIdentifier } from "@test/fixtures/platform.fixture";
import { Option } from "effect";

/** Safe request message expected to survive transport mapping. */
const SafeRequestMessage: string = "request violates a public constraint";

/** Retry delay used by overload mapping fixtures. */
const RetryAfterSeconds: number = 7;

/** One exhaustive public error mapping expectation. */
interface ErrorMappingCase {
  readonly error: PlatformError;
  readonly expected: PublicErrorResponse;
  readonly name: string;
  readonly status: number;
}

/** Complete mapping matrix for every current PlatformError discriminant. */
const ErrorMappingCases: readonly ErrorMappingCase[] = [
  {
    error: new ConfigError({ message: "private configuration details" }),
    expected: {
      code: HttpErrorCode.configuration,
      message: HttpErrorMessage.configuration,
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
      code: HttpErrorCode.databaseUnavailable,
      message: HttpErrorMessage.databaseUnavailable,
    },
    name: "redacts database failures",
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  {
    error: new EngineProtocolError({
      engineId: TestIdentifier.engine,
      message: "private malformed payload details",
    }),
    expected: {
      code: HttpErrorCode.engineProtocol,
      message: HttpErrorMessage.engineProtocol,
    },
    name: "redacts engine protocol failures",
    status: HttpStatus.BAD_GATEWAY,
  },
  {
    error: new EngineRejectedError({
      engineId: TestIdentifier.engine,
      message: "private rejection body",
      statusCode: HttpStatus.BAD_REQUEST,
    }),
    expected: {
      code: HttpErrorCode.engineRejected,
      message: HttpErrorMessage.engineRejected,
    },
    name: "redacts engine rejections",
    status: HttpStatus.BAD_GATEWAY,
  },
  {
    error: new EngineUnavailableError({
      engineId: TestIdentifier.engine,
      message: "private network details",
    }),
    expected: {
      code: HttpErrorCode.engineUnavailable,
      message: HttpErrorMessage.engineUnavailable,
    },
    name: "redacts engine availability failures",
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  {
    error: new StorageError({ message: "private result path" }),
    expected: {
      code: HttpErrorCode.storageUnavailable,
      message: HttpErrorMessage.storageUnavailable,
    },
    name: "redacts result storage failures",
    status: HttpStatus.SERVICE_UNAVAILABLE,
  },
  {
    error: new InvalidRequestError({ message: SafeRequestMessage }),
    expected: {
      code: HttpErrorCode.invalidRequest,
      message: SafeRequestMessage,
    },
    name: "preserves safe invalid request messages",
    status: HttpStatus.BAD_REQUEST,
  },
  {
    error: new JobNotCancellableError({
      id: "terminal-job",
      message: SafeRequestMessage,
    }),
    expected: {
      code: HttpErrorCode.jobNotCancellable,
      message: SafeRequestMessage,
    },
    name: "maps terminal cancellation conflicts",
    status: HttpStatus.CONFLICT,
  },
  {
    error: new JobNotFoundError({ id: "missing-job" }),
    expected: {
      code: HttpErrorCode.jobNotFound,
      message: HttpErrorMessage.jobNotFound,
    },
    name: "normalizes job not found failures",
    status: HttpStatus.NOT_FOUND,
  },
  {
    error: new LimitExceededError({
      limit: JobLimitName.pixels,
      message: SafeRequestMessage,
    }),
    expected: {
      code: HttpErrorCode.limitExceeded,
      message: SafeRequestMessage,
    },
    name: "maps configured request limits",
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  },
  {
    error: new QueueFullError({
      message: SafeRequestMessage,
      retryAfterSeconds: RetryAfterSeconds,
    }),
    expected: {
      code: HttpErrorCode.queueFull,
      message: SafeRequestMessage,
      retryAfterSeconds: RetryAfterSeconds,
    },
    name: "maps queue overload with retry metadata",
    status: HttpStatus.TOO_MANY_REQUESTS,
  },
  {
    error: new RateLimitedError({
      message: SafeRequestMessage,
      retryAfterSeconds: RetryAfterSeconds,
    }),
    expected: {
      code: HttpErrorCode.rateLimited,
      message: SafeRequestMessage,
      retryAfterSeconds: RetryAfterSeconds,
    },
    name: "maps local rate limiting with retry metadata",
    status: HttpStatus.TOO_MANY_REQUESTS,
  },
  {
    error: new UnauthorizedError({ message: "private token mismatch detail" }),
    expected: {
      code: HttpErrorCode.unauthorized,
      message: HttpErrorMessage.unauthorized,
    },
    name: "normalizes authentication failures",
    status: HttpStatus.UNAUTHORIZED,
  },
];

/**
 * Reads a mapped HTTP error response through NestJS' public exception contract.
 *
 * @param {PublicHttpException} exception - Mapped safe transport exception.
 * @returns {PublicErrorResponse} Structured public error body.
 */
const readResponse = (exception: PublicHttpException): PublicErrorResponse =>
  exception.getResponse();

describe("HTTP error mapper", (): void => {
  for (const mappingCase of ErrorMappingCases) {
    test(mappingCase.name, (): void => {
      const exception: PublicHttpException = mapPlatformErrorToHttp(
        mappingCase.error,
      );
      expect(exception.getStatus()).toBe(mappingCase.status);
      expect(readResponse(exception)).toEqual(mappingCase.expected);
      Option.match(
        Option.fromNullable(mappingCase.expected.retryAfterSeconds),
        {
          onNone: (): void => undefined,
          onSome: (seconds: number): void => {
            expect(exception.getRetryAfterSeconds()).toBe(seconds);
          },
        },
      );
    });
  }
});
