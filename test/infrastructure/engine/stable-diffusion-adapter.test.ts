import { describe, expect, test } from "bun:test";
import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { ErrorTag } from "@app/core/errors/error.constants";
import { EngineJobStatus } from "@app/infrastructure/engine/engine.constants";
import type {
  EngineGatewayError,
  EngineGatewayShape,
} from "@app/infrastructure/engine/engine.interface";
import type {
  EngineCapabilities,
  EngineJob,
  EngineSubmission,
} from "@app/infrastructure/engine/engine.types";
import {
  StableDiffusionEndpoint,
  StableDiffusionHttp,
  StableDiffusionJobAction,
  StableDiffusionJobKind,
  StableDiffusionJobStatus,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.constants";
import {
  buildStableDiffusionRequest,
  normalizeBaseUrl,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.helpers";
import {
  cancelStableDiffusionJob,
  createStableDiffusionGateway,
  getStableDiffusionCapabilities,
  pollStableDiffusionJob,
  stableDiffusionJobPath,
  submitStableDiffusionJob,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.service";
import { OutputFormat } from "@app/modules/jobs/job.constants";
import {
  FetchHttpClient,
  HttpClient,
  type HttpClientRequest,
} from "@effect/platform";
import {
  createPlatformConfigFixture,
  getFirstEngineFixture,
  JobRequestFixture,
} from "@test/fixtures/platform.fixture";
import { TestRemoteJobId } from "@test/fixtures/test.constants";
import { Effect, Either } from "effect";

/** Native job payload satisfying StableDiffusionJobSchema. */
const NativeJobFixture = {
  completed: null,
  created: 1,
  error: null,
  id: TestRemoteJobId.adapter,
  kind: StableDiffusionJobKind.imageGeneration,
  queue_position: 0,
  result: null,
  started: null,
  status: StableDiffusionJobStatus.generating,
} as const;

/** Native submission payload satisfying StableDiffusionJobSubmissionSchema. */
const NativeSubmissionFixture = {
  created: 1,
  id: TestRemoteJobId.adapter,
  kind: StableDiffusionJobKind.imageGeneration,
  poll_url: "/sdcpp/v1/jobs/remote-7",
  status: StableDiffusionJobStatus.queued,
} as const;

/** Native capability payload satisfying StableDiffusionCapabilitiesSchema. */
const NativeCapabilitiesFixture = {
  output_formats_by_mode: {
    [StableDiffusionJobKind.imageGeneration]: [OutputFormat.png],
  },
  supported_modes: [StableDiffusionJobKind.imageGeneration],
} as const;

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

/** Value reused across this suite. */
const StubEngineUrl: string = "http://engine:8080";

describe("stable-diffusion.cpp url and path building", (): void => {
  test("strips trailing slashes so endpoint concatenation stays stable", (): void => {
    expect(normalizeBaseUrl("http://engine:8080///")).toBe(StubEngineUrl);
    expect(normalizeBaseUrl(StubEngineUrl)).toBe(StubEngineUrl);
  });

  test("appends an action segment only when one is given", (): void => {
    expect(stableDiffusionJobPath(TestRemoteJobId.adapter)).toBe(
      "/sdcpp/v1/jobs/remote-7",
    );
    expect(
      stableDiffusionJobPath(
        TestRemoteJobId.adapter,
        StableDiffusionJobAction.cancel,
      ),
    ).toBe("/sdcpp/v1/jobs/remote-7/cancel");
  });

  test("attaches a JSON body only when the call carries one", (): void => {
    const engine: EngineConfig = engineAt("http://engine:8080/");
    const withoutBody: HttpClientRequest.HttpClientRequest =
      buildStableDiffusionRequest(
        engine,
        StableDiffusionEndpoint.capabilities,
        StableDiffusionHttp.methodGet,
        undefined,
      );
    const withBody: HttpClientRequest.HttpClientRequest =
      buildStableDiffusionRequest(
        engine,
        StableDiffusionEndpoint.imageGeneration,
        StableDiffusionHttp.methodPost,
        { prompt: "a cat" },
      );
    expect(withoutBody.url).toBe(
      `http://engine:8080${StableDiffusionEndpoint.capabilities}`,
    );
    expect(withoutBody.body._tag).toBe("Empty");
    expect(withBody.body._tag).toBe("Uint8Array");
  });
});

describe("stable-diffusion.cpp adapter over http", (): void => {
  test("reads native capabilities and keeps supported formats", async (): Promise<void> => {
    const engine: Bun.Server<undefined> = startEngine(
      alwaysJson(NativeCapabilitiesFixture, 200),
    );
    const result: Either.Either<EngineCapabilities, EngineGatewayError> =
      await runAdapter(
        (
          client: HttpClient.HttpClient,
        ): Effect.Effect<EngineCapabilities, EngineGatewayError> =>
          getStableDiffusionCapabilities(client, engineAt(engine.url.origin)),
      );
    await engine.stop(true);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.supportsImageGeneration).toBe(true);
      expect(result.right.outputFormats).toEqual([OutputFormat.png]);
    }
  });

  test("submits a generation request and returns the native identifier", async (): Promise<void> => {
    const engine: Bun.Server<undefined> = startEngine(
      alwaysJson(NativeSubmissionFixture, 202),
    );
    const result: Either.Either<EngineSubmission, EngineGatewayError> =
      await runAdapter(
        (
          client: HttpClient.HttpClient,
        ): Effect.Effect<EngineSubmission, EngineGatewayError> =>
          submitStableDiffusionJob(
            client,
            engineAt(engine.url.origin),
            JobRequestFixture,
          ),
      );
    await engine.stop(true);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.id).toBe(TestRemoteJobId.adapter);
    }
  });

  test("polls and cancels through the provider-neutral gateway", async (): Promise<void> => {
    const engine: Bun.Server<undefined> = startEngine(
      alwaysJson(NativeJobFixture, 200),
    );
    const config: EngineConfig = engineAt(engine.url.origin);
    const polled: Either.Either<EngineJob, EngineGatewayError> =
      await runAdapter(
        (
          client: HttpClient.HttpClient,
        ): Effect.Effect<EngineJob, EngineGatewayError> =>
          pollStableDiffusionJob(client, config, TestRemoteJobId.adapter),
      );
    const cancelled: Either.Either<EngineJob, EngineGatewayError> =
      await runAdapter(
        (
          client: HttpClient.HttpClient,
        ): Effect.Effect<EngineJob, EngineGatewayError> =>
          cancelStableDiffusionJob(client, config, TestRemoteJobId.adapter),
      );
    const routed: Either.Either<EngineJob, EngineGatewayError> =
      await runAdapter(
        (
          client: HttpClient.HttpClient,
        ): Effect.Effect<EngineJob, EngineGatewayError> => {
          const gateway: EngineGatewayShape =
            createStableDiffusionGateway(client);
          return gateway.poll(config, TestRemoteJobId.adapter);
        },
      );
    await engine.stop(true);
    for (const outcome of [polled, cancelled, routed]) {
      expect(Either.isRight(outcome)).toBe(true);
      if (Either.isRight(outcome)) {
        expect(outcome.right.id).toBe(TestRemoteJobId.adapter);
        expect(outcome.right.status).toBe(EngineJobStatus.running);
      }
    }
  });

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
