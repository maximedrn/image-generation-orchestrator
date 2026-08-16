import { afterEach, describe, expect, test } from "bun:test";
import { CoreModule } from "@app/core/core.module";
import { HttpErrorCode } from "@app/core/http/http.constants";
import type {
  HealthLiveResponse,
  HealthReadyResponse,
  PublicErrorResponse,
} from "@app/core/http/http.types";
import { HealthStatus } from "@app/modules/health/health.constants";
import { HealthModule } from "@app/modules/health/health.module";
import { JobStatus } from "@app/modules/jobs/job.constants";
import type { JobResponse } from "@app/modules/jobs/job.types";
import { JobsModule } from "@app/modules/jobs/jobs.module";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  createRuntimeHarness,
  type RuntimeHarness,
} from "@test/fixtures/app-runtime.fixture";
import { JobRequestFixture } from "@test/fixtures/platform.fixture";
import {
  TestCaller,
  TestHttpMethod,
  TestRoute,
} from "@test/fixtures/test.constants";
import type { LightMyRequestResponse } from "fastify";

/** Applications and runtimes opened by the running test. */
const OpenApps: { app: NestFastifyApplication; harness: RuntimeHarness }[] = [];

/** Authorization header matching the fixture API key. */
const AuthHeader = { authorization: TestCaller.bearerHeader } as const;

/**
 * Boots the HTTP stack over one real application runtime.
 *
 * @param {Parameters<typeof createRuntimeHarness>[0]} options - Runtime options.
 * @returns {Promise<NestFastifyApplication>} Initialized application.
 */
const createApiApp = async (
  options: Parameters<typeof createRuntimeHarness>[0] = {},
): Promise<NestFastifyApplication> => {
  const harness: RuntimeHarness = createRuntimeHarness(options);
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [CoreModule.register(harness.runtime), HealthModule, JobsModule],
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
  for (const open of OpenApps.splice(0)) {
    await open.app.close();
    await open.harness.dispose();
  }
});

describe("public job api over the real runtime", (): void => {
  test("admits, reads and cancels one job through durable storage", async (): Promise<void> => {
    const app: NestFastifyApplication = await createApiApp();
    const created: LightMyRequestResponse = await app.inject({
      headers: AuthHeader,
      method: TestHttpMethod.post,
      payload: JobRequestFixture,
      url: TestRoute.jobCollection,
    });
    expect(created.statusCode).toBe(201);
    const job: JobResponse = created.json<JobResponse>();
    expect(job.status).toBe(JobStatus.queued);
    expect(job.resultUrls).toEqual([]);

    const read: LightMyRequestResponse = await app.inject({
      headers: AuthHeader,
      method: TestHttpMethod.get,
      url: `/v1/jobs/${job.id}`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json<JobResponse>().id).toBe(job.id);

    const cancelled: LightMyRequestResponse = await app.inject({
      headers: AuthHeader,
      method: TestHttpMethod.delete,
      url: `/v1/jobs/${job.id}`,
    });
    expect(cancelled.statusCode).toBe(202);
    expect(cancelled.json<JobResponse>().status).toBe(JobStatus.cancelled);

    // Cancelling an already terminal job is a conflict, not a second success.
    const again: LightMyRequestResponse = await app.inject({
      headers: AuthHeader,
      method: TestHttpMethod.delete,
      url: `/v1/jobs/${job.id}`,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json<PublicErrorResponse>().code).toBe(
      HttpErrorCode.jobNotCancellable,
    );
  });

  test("rejects a request naming a model no engine serves", async (): Promise<void> => {
    const app: NestFastifyApplication = await createApiApp();
    const response: LightMyRequestResponse = await app.inject({
      headers: AuthHeader,
      method: TestHttpMethod.post,
      payload: { ...JobRequestFixture, model: "unregistered-model" },
      url: TestRoute.jobCollection,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<PublicErrorResponse>().code).toBe(
      HttpErrorCode.invalidRequest,
    );
  });

  test("rejects a request exceeding the configured dimension budget", async (): Promise<void> => {
    const app: NestFastifyApplication = await createApiApp();
    const response: LightMyRequestResponse = await app.inject({
      headers: AuthHeader,
      method: TestHttpMethod.post,
      payload: { ...JobRequestFixture, height: 4096, width: 4096 },
      url: TestRoute.jobCollection,
    });
    expect(response.statusCode).toBe(422);
    expect(response.json<PublicErrorResponse>().code).toBe(
      HttpErrorCode.limitExceeded,
    );
  });

  test("rate limits admission once the window budget is spent", async (): Promise<void> => {
    const app: NestFastifyApplication = await createApiApp();
    const statuses: number[] = [];
    for (let attempt: number = 0; attempt < 12; attempt += 1) {
      const response: LightMyRequestResponse = await app.inject({
        headers: AuthHeader,
        method: TestHttpMethod.post,
        payload: JobRequestFixture,
        url: TestRoute.jobCollection,
      });
      statuses.push(response.statusCode);
    }
    expect(
      statuses.filter((status: number): boolean => status === 201),
    ).toHaveLength(10);
    const limited: number = statuses.filter(
      (status: number): boolean => status === 429,
    ).length;
    expect(limited).toBe(2);
  });

  test("reports 404 for an unknown job and for an unpublished result", async (): Promise<void> => {
    const app: NestFastifyApplication = await createApiApp();
    const missing: LightMyRequestResponse = await app.inject({
      headers: AuthHeader,
      method: TestHttpMethod.get,
      url: "/v1/jobs/does-not-exist",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<PublicErrorResponse>().code).toBe(
      HttpErrorCode.jobNotFound,
    );

    const created: LightMyRequestResponse = await app.inject({
      headers: AuthHeader,
      method: TestHttpMethod.post,
      payload: JobRequestFixture,
      url: TestRoute.jobCollection,
    });
    const job: JobResponse = created.json<JobResponse>();
    // The job is still queued, so its results must not be readable yet.
    const result: LightMyRequestResponse = await app.inject({
      headers: AuthHeader,
      method: TestHttpMethod.get,
      url: `/v1/jobs/${job.id}/results/0`,
    });
    expect(result.statusCode).toBe(404);
  });
});

describe("health endpoints over the real runtime", (): void => {
  test("reports liveness without touching any dependency", async (): Promise<void> => {
    const app: NestFastifyApplication = await createApiApp();
    const response: LightMyRequestResponse = await app.inject({
      method: TestHttpMethod.get,
      url: TestRoute.healthLive,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<HealthLiveResponse>()).toEqual({
      status: HealthStatus.live,
    });
  });

  test("reports readiness once an engine advertises image generation", async (): Promise<void> => {
    const app: NestFastifyApplication = await createApiApp();
    const response: LightMyRequestResponse = await app.inject({
      method: TestHttpMethod.get,
      url: TestRoute.healthReady,
    });
    expect(response.statusCode).toBe(200);
    const body: HealthReadyResponse = response.json<HealthReadyResponse>();
    expect(body.status).toBe(HealthStatus.ready);
    expect(body.enginesAvailable).toBe(1);
  });

  test("refuses readiness when no engine can generate images", async (): Promise<void> => {
    const app: NestFastifyApplication = await createApiApp({
      engine: { supportsImageGeneration: false },
    });
    const response: LightMyRequestResponse = await app.inject({
      method: TestHttpMethod.get,
      url: TestRoute.healthReady,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json<PublicErrorResponse>().code).toBe(
      HttpErrorCode.engineUnavailable,
    );
  });
});
