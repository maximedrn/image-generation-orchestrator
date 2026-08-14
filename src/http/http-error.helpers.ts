import { HttpStatus } from "@nestjs/common";

import { ERROR_TAG } from "@app/error/error.constants.js";
import type { PlatformError } from "@app/error/error.types.js";
import {
  HTTP_ERROR_CODE,
  HTTP_ERROR_MESSAGE,
} from "@app/http/http.constants.js";
import { PublicHttpException } from "@app/http/public-http.types.js";
import type { PublicErrorResponse } from "@app/http/http.types.js";

/** Infrastructure failures that never expose internal details to callers. */
type InfrastructureError = Extract<
  PlatformError,
  | { readonly _tag: typeof ERROR_TAG.CONFIG }
  | { readonly _tag: typeof ERROR_TAG.DATABASE }
  | { readonly _tag: typeof ERROR_TAG.ENGINE_PROTOCOL }
  | { readonly _tag: typeof ERROR_TAG.ENGINE_REJECTED }
  | { readonly _tag: typeof ERROR_TAG.ENGINE_UNAVAILABLE }
  | { readonly _tag: typeof ERROR_TAG.STORAGE }
>;

/** Caller-facing failures whose safe messages are part of the public contract. */
type RequestError = Exclude<PlatformError, InfrastructureError>;

/**
 * Builds a safe public exception without serializing internal causes.
 *
 * @param code - (string) Stable public error code.
 * @param message - (string) Safe user-facing message.
 * @param status - (number) HTTP status code.
 * @param retryAfterSeconds - (number | undefined) Optional retry delay.
 * @returns (PublicHttpException) Safe HTTP exception.
 */
const publicException = (
  code: string,
  message: string,
  status: number,
  retryAfterSeconds?: number,
): PublicHttpException => {
  const response: PublicErrorResponse =
    retryAfterSeconds === undefined
      ? { code, message }
      : { code, message, retryAfterSeconds };
  return new PublicHttpException(response, status);
};

/**
 * Returns the defensive transport fallback for an impossible unmapped error branch.
 *
 * @returns (PublicHttpException) Redacted internal-server-error response.
 */
const unmappedPlatformError = (): PublicHttpException =>
  publicException(
    HTTP_ERROR_CODE.INTERNAL,
    HTTP_ERROR_MESSAGE.INTERNAL,
    HttpStatus.INTERNAL_SERVER_ERROR,
  );

/**
 * Maps infrastructure failures to redacted transport errors.
 *
 * @param error - (InfrastructureError) Typed infrastructure failure.
 * @returns (PublicHttpException) Safe transport-layer exception.
 */
const mapInfrastructureError = (
  error: InfrastructureError,
): PublicHttpException => {
  switch (error._tag) {
    case ERROR_TAG.CONFIG:
      return publicException(
        HTTP_ERROR_CODE.CONFIGURATION,
        HTTP_ERROR_MESSAGE.CONFIGURATION,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    case ERROR_TAG.DATABASE:
      return publicException(
        HTTP_ERROR_CODE.DATABASE_UNAVAILABLE,
        HTTP_ERROR_MESSAGE.DATABASE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    case ERROR_TAG.ENGINE_PROTOCOL:
      return publicException(
        HTTP_ERROR_CODE.ENGINE_PROTOCOL,
        HTTP_ERROR_MESSAGE.ENGINE_PROTOCOL,
        HttpStatus.BAD_GATEWAY,
      );
    case ERROR_TAG.ENGINE_REJECTED:
      return publicException(
        HTTP_ERROR_CODE.ENGINE_REJECTED,
        HTTP_ERROR_MESSAGE.ENGINE_REJECTED,
        HttpStatus.BAD_GATEWAY,
      );
    case ERROR_TAG.ENGINE_UNAVAILABLE:
      return publicException(
        HTTP_ERROR_CODE.ENGINE_UNAVAILABLE,
        HTTP_ERROR_MESSAGE.ENGINE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    case ERROR_TAG.STORAGE:
      return publicException(
        HTTP_ERROR_CODE.STORAGE_UNAVAILABLE,
        HTTP_ERROR_MESSAGE.STORAGE_UNAVAILABLE,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
  }
  return unmappedPlatformError();
};

/**
 * Maps safe caller-facing failures to the stable public HTTP contract.
 *
 * @param error - (RequestError) Typed request or domain failure.
 * @returns (PublicHttpException) Public transport-layer exception.
 */
const mapRequestError = (error: RequestError): PublicHttpException => {
  switch (error._tag) {
    case ERROR_TAG.INVALID_REQUEST:
      return publicException(
        HTTP_ERROR_CODE.INVALID_REQUEST,
        error.message,
        HttpStatus.BAD_REQUEST,
      );
    case ERROR_TAG.JOB_NOT_CANCELLABLE:
      return publicException(
        HTTP_ERROR_CODE.JOB_NOT_CANCELLABLE,
        error.message,
        HttpStatus.CONFLICT,
      );
    case ERROR_TAG.JOB_NOT_FOUND:
      return publicException(
        HTTP_ERROR_CODE.JOB_NOT_FOUND,
        HTTP_ERROR_MESSAGE.JOB_NOT_FOUND,
        HttpStatus.NOT_FOUND,
      );
    case ERROR_TAG.LIMIT_EXCEEDED:
      return publicException(
        HTTP_ERROR_CODE.LIMIT_EXCEEDED,
        error.message,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    case ERROR_TAG.QUEUE_FULL:
      return publicException(
        HTTP_ERROR_CODE.QUEUE_FULL,
        error.message,
        HttpStatus.TOO_MANY_REQUESTS,
        error.retryAfterSeconds,
      );
    case ERROR_TAG.RATE_LIMITED:
      return publicException(
        HTTP_ERROR_CODE.RATE_LIMITED,
        error.message,
        HttpStatus.TOO_MANY_REQUESTS,
        error.retryAfterSeconds,
      );
    case ERROR_TAG.UNAUTHORIZED:
      return publicException(
        HTTP_ERROR_CODE.UNAUTHORIZED,
        HTTP_ERROR_MESSAGE.UNAUTHORIZED,
        HttpStatus.UNAUTHORIZED,
      );
  }
  return unmappedPlatformError();
};

/**
 * Maps every typed platform error to a stable HTTP contract.
 *
 * @param error - (PlatformError) Explicit Effect error value.
 * @returns (PublicHttpException) Safe transport-layer exception.
 */
const mapPlatformErrorToHttp = (error: PlatformError): PublicHttpException => {
  switch (error._tag) {
    case ERROR_TAG.CONFIG:
    case ERROR_TAG.DATABASE:
    case ERROR_TAG.ENGINE_PROTOCOL:
    case ERROR_TAG.ENGINE_REJECTED:
    case ERROR_TAG.ENGINE_UNAVAILABLE:
    case ERROR_TAG.STORAGE:
      return mapInfrastructureError(error);
    case ERROR_TAG.INVALID_REQUEST:
    case ERROR_TAG.JOB_NOT_CANCELLABLE:
    case ERROR_TAG.JOB_NOT_FOUND:
    case ERROR_TAG.LIMIT_EXCEEDED:
    case ERROR_TAG.QUEUE_FULL:
    case ERROR_TAG.RATE_LIMITED:
    case ERROR_TAG.UNAUTHORIZED:
      return mapRequestError(error);
  }
  return unmappedPlatformError();
};

export {
  mapInfrastructureError,
  mapPlatformErrorToHttp,
  mapRequestError,
  publicException,
  unmappedPlatformError,
};
