import { Effect, Schema } from "effect";

import type { EngineConfig } from "@app/config/config.types.js";
import type { EngineGatewayError } from "@app/engine/engine.interface.js";
import { STABLE_DIFFUSION_HTTP } from "@app/engine/stable-diffusion.constants.js";
import type { StableDiffusionHttpMethod } from "@app/engine/stable-diffusion.types.js";
import {
  EngineProtocolError,
  EngineRejectedError,
  EngineUnavailableError,
} from "@app/error/error.types.js";
import { MILLISECONDS_PER_SECOND } from "@app/time/time.constants.js";

/**
 * Removes trailing slashes so endpoint concatenation stays deterministic.
 *
 * @param url - (string) Configured engine base URL.
 * @returns (string) Normalized URL without trailing slash.
 */
const normalizeBaseUrl = (url: string): string => url.replace(/\/+$/u, "");

/**
 * Executes one stable-diffusion.cpp HTTP request with typed transport failure.
 *
 * @param engine - (EngineConfig) Target engine configuration.
 * @param path - (string) Absolute native API path.
 * @param method - (StableDiffusionHttpMethod) HTTP method.
 * @param body - (unknown | undefined) Optional JSON request body.
 * @returns (Effect.Effect<Response, EngineUnavailableError>) HTTP response effect.
 */
const requestStableDiffusion = (
  engine: EngineConfig,
  path: string,
  method: StableDiffusionHttpMethod,
  body: unknown | undefined,
): Effect.Effect<Response, EngineUnavailableError> =>
  Effect.tryPromise({
    catch: (cause: unknown): EngineUnavailableError =>
      new EngineUnavailableError({
        engineId: engine.id,
        message: `engine request failed: ${String(cause)}`,
      }),
    try: (): Promise<Response> => {
      const timeoutMs: number =
        engine.requestTimeoutSeconds * MILLISECONDS_PER_SECOND;
      const headers: HeadersInit = {
        [STABLE_DIFFUSION_HTTP.HEADER_CONTENT_TYPE]:
          STABLE_DIFFUSION_HTTP.CONTENT_TYPE_JSON,
      };
      const init: RequestInit =
        body === undefined
          ? {
              headers,
              method,
              signal: AbortSignal.timeout(timeoutMs),
            }
          : {
              body: JSON.stringify(body),
              headers,
              method,
              signal: AbortSignal.timeout(timeoutMs),
            };
      return fetch(`${normalizeBaseUrl(engine.url)}${path}`, init);
    },
  });

/**
 * Converts an unexpected upstream status into an explicit typed rejection.
 *
 * @param engine - (EngineConfig) Target engine configuration.
 * @param response - (Response) Upstream HTTP response.
 * @returns (Effect.Effect<never, EngineRejectedError>) Failed effect.
 */
const rejectStableDiffusionResponse = (
  engine: EngineConfig,
  response: Response,
): Effect.Effect<never, EngineRejectedError> =>
  Effect.fail(
    new EngineRejectedError({
      engineId: engine.id,
      message: `engine rejected request with HTTP ${response.status}`,
      statusCode: response.status,
    }),
  );

/**
 * Parses unknown JSON from a successful upstream response.
 *
 * @param engine - (EngineConfig) Target engine configuration.
 * @param response - (Response) Successful upstream response.
 * @returns (Effect.Effect<unknown, EngineProtocolError>) Parsed JSON payload.
 */
const parseStableDiffusionJson = (
  engine: EngineConfig,
  response: Response,
): Effect.Effect<unknown, EngineProtocolError> =>
  Effect.tryPromise({
    catch: (cause: unknown): EngineProtocolError =>
      new EngineProtocolError({
        cause,
        engineId: engine.id,
        message: "engine returned invalid JSON",
      }),
    try: async (): Promise<unknown> => await response.json(),
  });

/**
 * Decodes one unknown upstream payload through an explicit Effect Schema.
 *
 * @param engine - (EngineConfig) Target engine configuration.
 * @param schema - (Schema.Schema<A>) Explicit native response schema.
 * @param value - (unknown) Parsed upstream JSON.
 * @returns (Effect.Effect<A, EngineProtocolError>) Decoded native payload.
 */
const decodeStableDiffusionPayload = <A>(
  engine: EngineConfig,
  schema: Schema.Schema<A>,
  value: unknown,
): Effect.Effect<A, EngineProtocolError> =>
  Schema.decodeUnknown(schema)(value).pipe(
    Effect.mapError(
      (cause: unknown): EngineProtocolError =>
        new EngineProtocolError({
          cause,
          engineId: engine.id,
          message: "engine response violates the expected schema",
        }),
    ),
  );

/**
 * Requests and decodes one native stable-diffusion.cpp payload.
 *
 * @param engine - (EngineConfig) Target engine configuration.
 * @param path - (string) Native API path.
 * @param method - (StableDiffusionHttpMethod) HTTP method.
 * @param expectedStatus - (number) Required HTTP success status.
 * @param schema - (Schema.Schema<A>) Native response schema.
 * @param body - (unknown | undefined) Optional JSON request body.
 * @returns (Effect.Effect<A, EngineGatewayError>) Decoded native payload.
 */
const requestDecodedStableDiffusion = <A>(
  engine: EngineConfig,
  path: string,
  method: StableDiffusionHttpMethod,
  expectedStatus: number,
  schema: Schema.Schema<A>,
  body: unknown | undefined,
): Effect.Effect<A, EngineGatewayError> =>
  requestStableDiffusion(engine, path, method, body).pipe(
    Effect.flatMap(
      (
        response: Response,
      ): Effect.Effect<unknown, EngineProtocolError | EngineRejectedError> =>
        response.status === expectedStatus
          ? parseStableDiffusionJson(engine, response)
          : rejectStableDiffusionResponse(engine, response),
    ),
    Effect.flatMap(
      (value: unknown): Effect.Effect<A, EngineProtocolError> =>
        decodeStableDiffusionPayload(engine, schema, value),
    ),
  );

export {
  decodeStableDiffusionPayload,
  normalizeBaseUrl,
  parseStableDiffusionJson,
  rejectStableDiffusionResponse,
  requestDecodedStableDiffusion,
  requestStableDiffusion,
};
