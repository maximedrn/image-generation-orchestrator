import { ErrorTag } from "@app/core/errors/error.constants";
import type { PlatformError } from "@app/core/errors/error.types";
import { HttpErrorCode, HttpErrorMessage } from "@app/core/http/http.constants";
import type { PublicErrorResponse } from "@app/core/http/http.types";
import { PublicHttpException } from "@app/core/http/public-http.types";
import { HttpStatus } from "@nestjs/common";
import { Option } from "effect";

/** Infrastructure failures that never expose internal details to callers. */
type InfrastructureError = Extract<
  PlatformError,
  | { readonly _tag: typeof ErrorTag.config }
  | { readonly _tag: typeof ErrorTag.database }
  | { readonly _tag: typeof ErrorTag.engineProtocol }
  | { readonly _tag: typeof ErrorTag.engineRejected }
  | { readonly _tag: typeof ErrorTag.engineUnavailable }
  | { readonly _tag: typeof ErrorTag.modelDownload }
  | { readonly _tag: typeof ErrorTag.storage }
>;

/** Caller-facing failures whose safe messages are part of the public contract. */
type RequestError = Exclude<PlatformError, InfrastructureError>;

/**
 * Builds a safe public exception without serializing internal causes.
 *
 * @param {string} code - Stable public error code.
 * @param {string} message - Safe user-facing message.
 * @param {number} status - HTTP status code.
 * @param {number | undefined} retryAfterSeconds - Optional retry delay.
 * @returns {PublicHttpException} Safe HTTP exception.
 */
const publicException = (
  code: string,
  message: string,
  status: number,
  retryAfterSeconds?: number,
): PublicHttpException => {
  const response: PublicErrorResponse = Option.match(
    Option.fromNullable(retryAfterSeconds),
    {
      onNone: (): PublicErrorResponse => ({ code, message }),
      onSome: (seconds: number): PublicErrorResponse => ({
        code,
        message,
        retryAfterSeconds: seconds,
      }),
    },
  );
  return new PublicHttpException(response, status);
};

/**
 * Returns the defensive transport fallback for an impossible unmapped error branch.
 *
 * @returns {PublicHttpException} Redacted internal-server-error response.
 */
const unmappedPlatformError = (): PublicHttpException =>
  publicException(
    HttpErrorCode.internal,
    HttpErrorMessage.internal,
    HttpStatus.INTERNAL_SERVER_ERROR,
  );

/**
 * Maps infrastructure failures to redacted transport errors.
 *
 * @param {InfrastructureError} error - Typed infrastructure failure.
 * @returns {PublicHttpException} Safe transport-layer exception.
 */
const mapInfrastructureError = (
  error: InfrastructureError,
): PublicHttpException => {
  switch (error._tag) {
    case ErrorTag.config:
      return publicException(
        HttpErrorCode.configuration,
        HttpErrorMessage.configuration,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    case ErrorTag.database:
      return publicException(
        HttpErrorCode.databaseUnavailable,
        HttpErrorMessage.databaseUnavailable,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    case ErrorTag.engineProtocol:
      return publicException(
        HttpErrorCode.engineProtocol,
        HttpErrorMessage.engineProtocol,
        HttpStatus.BAD_GATEWAY,
      );
    case ErrorTag.engineRejected:
      return publicException(
        HttpErrorCode.engineRejected,
        HttpErrorMessage.engineRejected,
        HttpStatus.BAD_GATEWAY,
      );
    case ErrorTag.engineUnavailable:
      return publicException(
        HttpErrorCode.engineUnavailable,
        HttpErrorMessage.engineUnavailable,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    case ErrorTag.modelDownload:
    case ErrorTag.storage:
      return publicException(
        HttpErrorCode.storageUnavailable,
        HttpErrorMessage.storageUnavailable,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    default:
      return unmappedPlatformError();
  }
};

/**
 * Maps safe caller-facing failures to the stable public HTTP contract.
 *
 * @param {RequestError} error - Typed request or domain failure.
 * @returns {PublicHttpException} Public transport-layer exception.
 */
const mapRequestError = (error: RequestError): PublicHttpException => {
  switch (error._tag) {
    case ErrorTag.invalidRequest:
      return publicException(
        HttpErrorCode.invalidRequest,
        error.message,
        HttpStatus.BAD_REQUEST,
      );
    case ErrorTag.jobNotCancellable:
      return publicException(
        HttpErrorCode.jobNotCancellable,
        error.message,
        HttpStatus.CONFLICT,
      );
    case ErrorTag.jobNotFound:
      return publicException(
        HttpErrorCode.jobNotFound,
        HttpErrorMessage.jobNotFound,
        HttpStatus.NOT_FOUND,
      );
    case ErrorTag.limitExceeded:
      return publicException(
        HttpErrorCode.limitExceeded,
        error.message,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    case ErrorTag.queueFull:
      return publicException(
        HttpErrorCode.queueFull,
        error.message,
        HttpStatus.TOO_MANY_REQUESTS,
        error.retryAfterSeconds,
      );
    case ErrorTag.rateLimited:
      return publicException(
        HttpErrorCode.rateLimited,
        error.message,
        HttpStatus.TOO_MANY_REQUESTS,
        error.retryAfterSeconds,
      );
    case ErrorTag.unauthorized:
      return publicException(
        HttpErrorCode.unauthorized,
        HttpErrorMessage.unauthorized,
        HttpStatus.UNAUTHORIZED,
      );
    default:
      return unmappedPlatformError();
  }
};

/**
 * Maps every typed platform error to a stable HTTP contract.
 *
 * @param {PlatformError} error - Explicit Effect error value.
 * @returns {PublicHttpException} Safe transport-layer exception.
 */
const mapPlatformErrorToHttp = (error: PlatformError): PublicHttpException => {
  switch (error._tag) {
    case ErrorTag.config:
    case ErrorTag.database:
    case ErrorTag.engineProtocol:
    case ErrorTag.engineRejected:
    case ErrorTag.engineUnavailable:
    case ErrorTag.modelDownload:
    case ErrorTag.storage:
      return mapInfrastructureError(error);
    case ErrorTag.invalidRequest:
    case ErrorTag.jobNotCancellable:
    case ErrorTag.jobNotFound:
    case ErrorTag.limitExceeded:
    case ErrorTag.queueFull:
    case ErrorTag.rateLimited:
    case ErrorTag.unauthorized:
      return mapRequestError(error);
    default:
      return unmappedPlatformError();
  }
};

export {
  mapInfrastructureError,
  mapPlatformErrorToHttp,
  mapRequestError,
  publicException,
  unmappedPlatformError,
};
