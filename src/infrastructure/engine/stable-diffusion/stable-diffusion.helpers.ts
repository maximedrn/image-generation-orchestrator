import type { EngineConfig } from "@app/core/config/config.types";
import {
  EngineBusyError,
  EngineJobNotFoundError,
  EngineProtocolError,
  EngineRejectedError,
  EngineUnavailableError,
} from "@app/core/errors/error.types";
import type { EngineGatewayError } from "@app/infrastructure/engine/engine.interface";
import {
  StableDiffusionHttp,
  StableDiffusionMessage,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.constants";
import type { StableDiffusionHttpMethod } from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.types";
import {
  HttpBody,
  type HttpClient,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { Duration, Effect, Option, type Schema } from "effect";

/** One native call: path, verb, expected status, response schema and body. */
interface StableDiffusionRequest<A> {
  readonly body: unknown;
  readonly expectedStatus: number;
  readonly method: StableDiffusionHttpMethod;
  readonly path: string;
  readonly schema: Schema.Schema<A>;
}

/** Trailing slashes stripped from every configured engine base URL. */
const TrailingSlashPattern = /\/+$/u;

/**
 * Removes trailing slashes so endpoint concatenation stays deterministic.
 *
 * @param {string} url - Configured engine base URL.
 * @returns {string} Normalized URL without trailing slash.
 */
const normalizeBaseUrl = (url: string): string =>
  url.replace(TrailingSlashPattern, "");

/**
 * Builds one native request, attaching a JSON body only when there is one.
 *
 * @param {EngineConfig} engine - Target engine configuration.
 * @param {string} path - Absolute native API path.
 * @param {StableDiffusionHttpMethod} method - HTTP method.
 * @param {unknown} body - Optional JSON request body.
 * @returns {HttpClientRequest.HttpClientRequest} Prepared native request.
 */
const buildStableDiffusionRequest = (
  engine: EngineConfig,
  path: string,
  method: StableDiffusionHttpMethod,
  body: unknown,
): HttpClientRequest.HttpClientRequest => {
  const request: HttpClientRequest.HttpClientRequest = HttpClientRequest.make(
    method,
  )(`${normalizeBaseUrl(engine.url)}${path}`);
  return Option.match(Option.fromNullable(body), {
    onNone: (): HttpClientRequest.HttpClientRequest => request,
    onSome: (payload: unknown): HttpClientRequest.HttpClientRequest =>
      HttpClientRequest.setBody(
        request,
        HttpBody.text(
          JSON.stringify(payload),
          StableDiffusionHttp.contentTypeJson,
        ),
      ),
  });
};

/**
 * Decodes one native payload, or converts an unexpected status into a rejection.
 *
 * @param {EngineConfig} engine - Target engine configuration.
 * @param {number} expectedStatus - Required HTTP success status.
 * @param {Schema.Schema<A>} schema - Native response schema.
 * @param {HttpClientResponse.HttpClientResponse} response - Upstream response.
 * @returns {Effect.Effect<A, EngineGatewayError>} Decoded native payload.
 */
const decodeStableDiffusionResponse = <A>(
  engine: EngineConfig,
  expectedStatus: number,
  schema: Schema.Schema<A>,
  response: HttpClientResponse.HttpClientResponse,
): Effect.Effect<A, EngineGatewayError> =>
  response.status === expectedStatus
    ? HttpClientResponse.schemaBodyJson(schema)(response).pipe(
        Effect.mapError(
          (cause: unknown): EngineProtocolError =>
            new EngineProtocolError({
              cause,
              engineId: engine.id,
              message: StableDiffusionMessage.schemaViolation,
            }),
        ),
      )
    : response.status === StableDiffusionHttp.conflict
      ? Effect.fail(
          new EngineBusyError({
            engineId: engine.id,
            message: StableDiffusionMessage.busy,
          }),
        )
      : response.status === StableDiffusionHttp.notFound ||
          response.status === StableDiffusionHttp.gone
        ? Effect.fail(
            new EngineJobNotFoundError({
              engineId: engine.id,
              message: StableDiffusionMessage.jobNotFound,
            }),
          )
        : response.text.pipe(
            // The upstream body is the only place the real cause appears; without
            // it a rejection is just a status code and has to be reproduced by hand.
            Effect.catchAll((): Effect.Effect<string> => Effect.succeed("")),
            Effect.flatMap(
              (body: string): Effect.Effect<never, EngineRejectedError> =>
                Effect.fail(
                  new EngineRejectedError({
                    engineId: engine.id,
                    message: `${StableDiffusionMessage.rejected}: ${response.status} ${body.slice(0, StableDiffusionHttp.maxLoggedBodyLength)}`,
                    statusCode: response.status,
                  }),
                ),
            ),
          );

/**
 * Requests and decodes one native stable-diffusion.cpp payload.
 *
 * @param {HttpClient.HttpClient} client - Effect HTTP client.
 * @param {EngineConfig} engine - Target engine configuration.
 * @param {StableDiffusionRequest<A>} request - Native call description.
 * @returns {Effect.Effect<A, EngineGatewayError>} Decoded native payload.
 */
const requestDecodedStableDiffusion = <A>(
  client: HttpClient.HttpClient,
  engine: EngineConfig,
  request: StableDiffusionRequest<A>,
): Effect.Effect<A, EngineGatewayError> => {
  const { body, expectedStatus, method, path, schema } = request;
  return client
    .execute(buildStableDiffusionRequest(engine, path, method, body))
    .pipe(
      Effect.timeout(Duration.seconds(engine.requestTimeoutSeconds)),
      Effect.mapError(
        (cause: unknown): EngineUnavailableError =>
          new EngineUnavailableError({
            engineId: engine.id,
            message: `${StableDiffusionMessage.requestFailed}: ${String(cause)}`,
          }),
      ),
      Effect.flatMap(
        (
          response: HttpClientResponse.HttpClientResponse,
        ): Effect.Effect<A, EngineGatewayError> =>
          decodeStableDiffusionResponse(
            engine,
            expectedStatus,
            schema,
            response,
          ),
      ),
      Effect.scoped,
    );
};

export type { StableDiffusionRequest };
export {
  buildStableDiffusionRequest,
  decodeStableDiffusionResponse,
  normalizeBaseUrl,
  requestDecodedStableDiffusion,
};
