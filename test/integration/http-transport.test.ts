import { describe, expect, test } from "bun:test";
import { CoreModule } from "@app/core/core.module";
import {
  QueueFullError,
  UnauthorizedError,
} from "@app/core/errors/error.types";
import {
  HttpErrorCode,
  HttpErrorMessage,
  HttpHeader,
} from "@app/core/http/http.constants";
import type {
  HealthLiveResponse,
  PublicErrorResponse,
} from "@app/core/http/http.types";
import { HttpEffectService } from "@app/core/http/http-effect.service";
import { mapPlatformErrorToHttp } from "@app/core/http/http-error.helpers";
import type { AppRuntime } from "@app/core/runtime/runtime.types";
import { BearerAuth } from "@app/core/security/security.constants";
import { HealthStatus } from "@app/modules/health/health.constants";
import { HealthModule } from "@app/modules/health/health.module";
import { JobMessage } from "@app/modules/jobs/job.constants";
import { JobsModule } from "@app/modules/jobs/jobs.module";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import { JobRequestFixture } from "@test/fixtures/platform.fixture";
import { TestHttpMethod, TestRoute } from "@test/fixtures/test.constants";
import type { LightMyRequestResponse } from "fastify";

/** Behaviour a stubbed transport bridge performs when a handler runs an Effect. */
type RunHandler = () => unknown;

/** Bearer token accepted by the stubbed authorization behaviour. */
const AcceptedToken: string = "transport-test-token";

/**
 * Replaces the Effect bridge so transport concerns are exercised in isolation.
 *
 * Application behaviour is covered by the Effect-level suites; what matters
 * here is that Nest routes, guards, pipes and filters are wired correctly.
 */
class HttpEffectStub {
  readonly #run: RunHandler;

  /**
   * Creates a bridge returning one scripted outcome.
   *
   * @param {RunHandler} run - Value producer, or thrower for failure paths.
   */
  constructor(run: RunHandler) {
    this.#run = run;
  }

  /**
   * Produces the scripted outcome for one handler invocation.
   *
   * @returns {Promise<unknown>} Scripted value, or a rejection on failure.
   */
  run(): Promise<unknown> {
    return Promise.resolve(this.#run());
  }
}

/** Runtime placeholder: the stubbed bridge never reaches the Effect runtime. */
const UnusedRuntime = {
  dispose: (): Promise<void> => Promise.resolve(),
} as unknown as AppRuntime;

/**
 * Boots the real HTTP stack over a scripted Effect bridge.
 *
 * @param {RunHandler} run - Outcome produced by every handler-level Effect.
 * @returns {Promise<NestFastifyApplication>} Initialized Fastify application.
 */
const createTransportApp = async (
  run: RunHandler,
  logged?: string[],
): Promise<NestFastifyApplication> => {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [CoreModule.register(UnusedRuntime), HealthModule, JobsModule],
  })
    .overrideProvider(HttpEffectService)
    .useValue(new HttpEffectStub(run))
    .compile();
  const app: NestFastifyApplication =
    moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({
        logger: {
          level: "error",
          // Captures what the filter writes, standing in for the pino sink.
          stream: {
            write: (line: string): void => {
              logged?.push(line);
            },
          },
        },
      }),
    );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
};

/**
 * Rejects every Effect as an unauthorized request, as the guard would.
 *
 * @returns {never} Always throws the mapped public exception.
 */
const rejectAsUnauthorized = (): never => {
  throw mapPlatformErrorToHttp(
    new UnauthorizedError({ message: "unauthenticated" }),
  );
};

describe("http transport", (): void => {
  test("serves liveness without authentication", async (): Promise<void> => {
    const app: NestFastifyApplication =
      await createTransportApp(rejectAsUnauthorized);
    const response: LightMyRequestResponse = await app.inject({
      method: TestHttpMethod.get,
      url: TestRoute.healthLive,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<HealthLiveResponse>()).toEqual({
      status: HealthStatus.live,
    });
    await app.close();
  });

  test("rejects an unauthenticated job read through the guard", async (): Promise<void> => {
    const app: NestFastifyApplication =
      await createTransportApp(rejectAsUnauthorized);
    const response: LightMyRequestResponse = await app.inject({
      method: TestHttpMethod.get,
      url: "/v1/jobs/any",
    });
    expect(response.statusCode).toBe(401);
    expect(response.json<PublicErrorResponse>()).toEqual({
      code: HttpErrorCode.unauthorized,
      message: HttpErrorMessage.unauthorized,
    });
    await app.close();
  });

  test("rejects a malformed body at the boundary before the handler runs", async (): Promise<void> => {
    let handlerRuns: number = 0;
    const app: NestFastifyApplication = await createTransportApp(
      (): unknown => {
        handlerRuns += 1;
        return undefined;
      },
    );
    const response: LightMyRequestResponse = await app.inject({
      headers: { authorization: `${BearerAuth.prefix}${AcceptedToken}` },
      method: TestHttpMethod.post,
      payload: { ...JobRequestFixture, width: "512" },
      url: TestRoute.jobCollection,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<PublicErrorResponse>()).toEqual({
      code: HttpErrorCode.invalidRequest,
      message: JobMessage.invalidRequest,
    });
    // One run for the guard, none for the handler: the pipe stopped the request.
    expect(handlerRuns).toBe(1);
    await app.close();
  });

  test("rejects an unknown body member so payloads carry no silent extras", async (): Promise<void> => {
    const app: NestFastifyApplication = await createTransportApp(
      (): unknown => undefined,
    );
    const response: LightMyRequestResponse = await app.inject({
      headers: { authorization: `${BearerAuth.prefix}${AcceptedToken}` },
      method: TestHttpMethod.post,
      payload: { ...JobRequestFixture, unexpected: true },
      url: TestRoute.jobCollection,
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  test("rejects a non-integer result index at the boundary", async (): Promise<void> => {
    const app: NestFastifyApplication = await createTransportApp(
      (): unknown => undefined,
    );
    const response: LightMyRequestResponse = await app.inject({
      headers: { authorization: `${BearerAuth.prefix}${AcceptedToken}` },
      method: TestHttpMethod.get,
      url: "/v1/jobs/any/results/1.5",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<PublicErrorResponse>()).toEqual({
      code: HttpErrorCode.invalidRequest,
      message: "index must be an integer",
    });
    await app.close();
  });

  test("logs an unmapped defect and redacts it from the response", async (): Promise<void> => {
    const logged: string[] = [];
    let guardPassed: boolean = false;
    const app: NestFastifyApplication = await createTransportApp(
      (): unknown => {
        if (!guardPassed) {
          guardPassed = true;
          return undefined;
        }
        throw new Error("SENTINEL-INTERNAL-DETAIL");
      },
      logged,
    );
    const response: LightMyRequestResponse = await app.inject({
      headers: { authorization: `${BearerAuth.prefix}${AcceptedToken}` },
      method: TestHttpMethod.get,
      url: "/v1/jobs/any",
    });
    await app.close();
    expect(response.statusCode).toBe(500);
    expect(response.json<PublicErrorResponse>()).toEqual({
      code: HttpErrorCode.internal,
      message: HttpErrorMessage.internal,
    });
    // The cause reaches the operator log and nothing else.
    expect(response.body).not.toContain("SENTINEL-INTERNAL-DETAIL");
    expect(logged.join("")).toContain("SENTINEL-INTERNAL-DETAIL");
  });

  test("keeps the framework 404 for a route that does not exist", async (): Promise<void> => {
    const app: NestFastifyApplication = await createTransportApp(
      (): unknown => undefined,
    );
    const response: LightMyRequestResponse = await app.inject({
      method: TestHttpMethod.get,
      url: "/nope",
    });
    await app.close();
    expect(response.statusCode).toBe(404);
  });

  test("emits Retry-After through the globally registered filter", async (): Promise<void> => {
    let guardPassed: boolean = false;
    const app: NestFastifyApplication = await createTransportApp(
      (): unknown => {
        if (!guardPassed) {
          guardPassed = true;
          return undefined;
        }
        throw mapPlatformErrorToHttp(
          new QueueFullError({
            message: "queue is full",
            retryAfterSeconds: 7,
          }),
        );
      },
    );
    const response: LightMyRequestResponse = await app.inject({
      headers: { authorization: `${BearerAuth.prefix}${AcceptedToken}` },
      method: TestHttpMethod.post,
      payload: JobRequestFixture,
      url: TestRoute.jobCollection,
    });
    expect(response.statusCode).toBe(429);
    expect(response.headers[HttpHeader.retryAfter]).toBe("7");
    expect(response.json<PublicErrorResponse>()).toEqual({
      code: HttpErrorCode.queueFull,
      message: "queue is full",
      retryAfterSeconds: 7,
    });
    await app.close();
  });
});
