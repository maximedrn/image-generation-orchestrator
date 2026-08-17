import { afterEach, describe, expect, test } from "bun:test";
import { CoreModule } from "@app/core/core.module";
import { HttpErrorCode, HttpRoute } from "@app/core/http/http.constants";
import type {
  MetricsResponse,
  PublicErrorResponse,
} from "@app/core/http/http.types";
import { EngineHealth } from "@app/infrastructure/engine/engine.constants";
import type { EngineView } from "@app/infrastructure/engine/engine.types";
import { EnginesModule } from "@app/modules/engines/engines.module";
import { MetricsModule } from "@app/modules/metrics/metrics.module";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  createRuntimeHarness,
  type RuntimeHarness,
} from "@test/fixtures/app-runtime.fixture";
import {
  TestCaller,
  TestHttpMethod,
  TestRoute,
} from "@test/fixtures/test.constants";
import type { LightMyRequestResponse } from "fastify";

/** Applications opened by the running test. */
const OpenApps: { app: NestFastifyApplication; harness: RuntimeHarness }[] = [];

/** Authorization header matching the fixture API key. */
const AuthHeader = { authorization: TestCaller.bearerHeader } as const;

/**
 * Boots the read-only observability routes over one real runtime.
 *
 * @returns {Promise<NestFastifyApplication>} Initialized application.
 */
const createObservabilityApp = async (): Promise<NestFastifyApplication> => {
  const harness: RuntimeHarness = createRuntimeHarness();
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      CoreModule.register(harness.runtime),
      EnginesModule,
      MetricsModule,
    ],
  }).compile();
  const app: NestFastifyApplication =
    moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ logger: false }),
    );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  OpenApps.push({ app, harness });
  return app;
};

afterEach(async (): Promise<void> => {
  const opened: { app: NestFastifyApplication; harness: RuntimeHarness }[] =
    OpenApps.splice(0, OpenApps.length);
  for (const entry of opened) {
    await entry.app.close();
    await entry.harness.dispose();
  }
});

describe("engine registry route", (): void => {
  test("lists the configured engines with their scheduler state", async (): Promise<void> => {
    const app: NestFastifyApplication = await createObservabilityApp();
    const response: LightMyRequestResponse = await app.inject({
      headers: AuthHeader,
      method: TestHttpMethod.get,
      url: TestRoute.engineCollection,
    });
    const engines: readonly EngineView[] =
      response.json<readonly EngineView[]>();
    expect(response.statusCode).toBe(200);
    expect(engines.length).toBeGreaterThan(0);
    expect(engines[0]?.health).toBe(EngineHealth.healthy);
    expect(engines[0]?.running).toBe(0);
  });

  test("rejects an unauthenticated caller", async (): Promise<void> => {
    const app: NestFastifyApplication = await createObservabilityApp();
    const response: LightMyRequestResponse = await app.inject({
      method: TestHttpMethod.get,
      url: TestRoute.engineCollection,
    });
    const body: PublicErrorResponse = response.json<PublicErrorResponse>();
    expect(response.statusCode).toBe(401);
    expect(body.code).toBe(HttpErrorCode.unauthorized);
  });
});

describe("metrics route", (): void => {
  test("reports the queue depth and the engines it schedules on", async (): Promise<void> => {
    const app: NestFastifyApplication = await createObservabilityApp();
    const response: LightMyRequestResponse = await app.inject({
      headers: AuthHeader,
      method: TestHttpMethod.get,
      url: TestRoute.metrics,
    });
    const metrics: MetricsResponse = response.json<MetricsResponse>();
    expect(response.statusCode).toBe(200);
    expect(metrics.queuedJobs).toBe(0);
    expect(metrics.engines.length).toBeGreaterThan(0);
  });

  test("rejects an unauthenticated caller", async (): Promise<void> => {
    const app: NestFastifyApplication = await createObservabilityApp();
    const response: LightMyRequestResponse = await app.inject({
      method: TestHttpMethod.get,
      url: TestRoute.metrics,
    });
    const body: PublicErrorResponse = response.json<PublicErrorResponse>();
    expect(response.statusCode).toBe(401);
    expect(body.code).toBe(HttpErrorCode.unauthorized);
  });
});

/** Route constants the suite relies on, asserted so a rename is caught here. */
describe("route constants", (): void => {
  test("expose the documented absolute paths", (): void => {
    expect(TestRoute.engineCollection).toBe(`/${HttpRoute.engineCollection}`);
    expect(TestRoute.metrics).toBe(`/${HttpRoute.metrics}`);
  });
});
