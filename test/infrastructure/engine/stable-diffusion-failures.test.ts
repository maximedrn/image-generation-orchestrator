import { describe, expect, test } from "bun:test";
import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { ErrorTag } from "@app/core/errors/error.constants";
import type { EngineGatewayError } from "@app/infrastructure/engine/engine.interface";
import type {
  EngineCapabilities,
  EngineJob,
} from "@app/infrastructure/engine/engine.types";
import {
  cancelStableDiffusionJob,
  getStableDiffusionCapabilities,
  pollStableDiffusionJob,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.service";
import { FetchHttpClient, HttpClient } from "@effect/platform";
import {
  createPlatformConfigFixture,
  getFirstEngineFixture,
} from "@test/fixtures/platform.fixture";
import { TestRemoteJobId } from "@test/fixtures/test.constants";
import { Effect, Either } from "effect";

/**
 * Serves canned native payloads so the adapter runs against real HTTP.
 *
 * @param {(path: string) => Response} route - Response chosen per request path.
 * @returns {Bun.Server<undefined>} Listening stub engine.
 */
const startEngine = (
  route: (path: string) => Response,
): Bun.Server<undefined> =>
  Bun.serve({
    fetch: (request: Request): Response => route(new URL(request.url).pathname),
    port: 0,
  });

/**
 * Builds an engine configuration pointing at one in-process stub engine.
 *
 * @param {string} url - Stub engine base URL.
 * @returns {EngineConfig} Engine configuration under test.
 */
const engineAt = (url: string): EngineConfig => {
  const config: PlatformConfig = createPlatformConfigFixture("/tmp/sdcpp");
  return { ...getFirstEngineFixture(config), url };
};

/**
 * Runs one adapter effect against a real HTTP client, keeping failures typed.
 *
 * @param {(client: HttpClient.HttpClient) => Effect.Effect<A, EngineGatewayError>} call - Adapter call.
 * @returns {Promise<Either.Either<A, EngineGatewayError>>} Materialized outcome.
 */
const runAdapter = <A>(
  call: (client: HttpClient.HttpClient) => Effect.Effect<A, EngineGatewayError>,
): Promise<Either.Either<A, EngineGatewayError>> =>
  Effect.runPromise(
    HttpClient.HttpClient.pipe(
      Effect.flatMap(
        (
          client: HttpClient.HttpClient,
        ): Effect.Effect<Either.Either<A, EngineGatewayError>> =>
          Effect.either(call(client)),
      ),
      Effect.provide(FetchHttpClient.layer),
    ),
  );

/**
 * Serves one native payload as JSON for every request path.
 *
 * @param {unknown} payload - Native response body.
 * @param {number} status - HTTP status to return.
 * @returns {(path: string) => Response} Constant route.
 */
const alwaysJson =
  (payload: unknown, status: number) =>
  (_path: string): Response =>
    Response.json(payload, { status });

describe("stable-diffusion.cpp adapter failure mapping", (): void => {
  test("rejects an unexpected upstream status as an engine rejection", async (): Promise<void> => {
    const engine: Bun.Server<undefined> = startEngine(
      alwaysJson({ detail: "busy" }, 503),
    );
    const result: Either.Either<EngineCapabilities, EngineGatewayError> =
      await runAdapter(
        (
          client: HttpClient.HttpClient,
        ): Effect.Effect<EngineCapabilities, EngineGatewayError> =>
          getStableDiffusionCapabilities(client, engineAt(engine.url.origin)),
      );
    await engine.stop(true);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(ErrorTag.engineRejected);
    }
  });

  test("reports a refusal to interrupt as a retryable busy answer", async (): Promise<void> => {
    const engine: Bun.Server<undefined> = startEngine(
      alwaysJson({ error: "job is currently generating" }, 409),
    );
    const result: Either.Either<EngineJob, EngineGatewayError> =
      await runAdapter(
        (
          client: HttpClient.HttpClient,
        ): Effect.Effect<EngineJob, EngineGatewayError> =>
          cancelStableDiffusionJob(
            client,
            engineAt(engine.url.origin),
            TestRemoteJobId.adapter,
          ),
      );
    await engine.stop(true);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      // "Not yet" must not be reported as a rejection, or the dispatcher
      // would open its breaker against a healthy engine.
      expect(result.left._tag).toBe(ErrorTag.engineBusy);
    }
  });

  test("reports a forgotten remote job distinctly from a rejection", async (): Promise<void> => {
    const engine: Bun.Server<undefined> = startEngine(
      alwaysJson({ error: "job not found" }, 404),
    );
    const result: Either.Either<EngineJob, EngineGatewayError> =
      await runAdapter(
        (
          client: HttpClient.HttpClient,
        ): Effect.Effect<EngineJob, EngineGatewayError> =>
          pollStableDiffusionJob(
            client,
            engineAt(engine.url.origin),
            TestRemoteJobId.adapter,
          ),
      );
    await engine.stop(true);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      // A dispatcher must be able to tell "gone" from "refused" to decide
      // between resubmitting the work and backing off the engine.
      expect(result.left._tag).toBe(ErrorTag.engineJobNotFound);
    }
  });

  test("rejects a payload that violates the native schema", async (): Promise<void> => {
    const engine: Bun.Server<undefined> = startEngine(
      alwaysJson({ unexpected: true }, 200),
    );
    const result: Either.Either<EngineJob, EngineGatewayError> =
      await runAdapter(
        (
          client: HttpClient.HttpClient,
        ): Effect.Effect<EngineJob, EngineGatewayError> =>
          pollStableDiffusionJob(
            client,
            engineAt(engine.url.origin),
            TestRemoteJobId.adapter,
          ),
      );
    await engine.stop(true);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(ErrorTag.engineProtocol);
    }
  });

  test("reports an unreachable engine as unavailable rather than rejected", async (): Promise<void> => {
    const result: Either.Either<EngineCapabilities, EngineGatewayError> =
      await runAdapter(
        (
          client: HttpClient.HttpClient,
        ): Effect.Effect<EngineCapabilities, EngineGatewayError> =>
          getStableDiffusionCapabilities(
            client,
            engineAt("http://127.0.0.1:1"),
          ),
      );
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(ErrorTag.engineUnavailable);
    }
  });
});

describe("expired remote job", (): void => {
  test("treats a gone job like one the engine forgot", async (): Promise<void> => {
    // The API documents 410 for a job purged after expiry: the work is over,
    // exactly like 404, and must not be mistaken for an engine outage.
    const engine: Bun.Server<undefined> = startEngine(
      alwaysJson({ error: "job expired" }, 410),
    );
    const result: Either.Either<EngineJob, EngineGatewayError> =
      await runAdapter(
        (
          client: HttpClient.HttpClient,
        ): Effect.Effect<EngineJob, EngineGatewayError> =>
          pollStableDiffusionJob(
            client,
            engineAt(engine.url.origin),
            TestRemoteJobId.adapter,
          ),
      );
    await engine.stop(true);
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe(ErrorTag.engineJobNotFound);
    }
  });
});
