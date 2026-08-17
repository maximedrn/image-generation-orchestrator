import { afterEach, describe, expect, test } from "bun:test";
import { CoreModule } from "@app/core/core.module";
import { HttpHeader, HttpRoute } from "@app/core/http/http.constants";
import { DocsMediaType, DocsUi } from "@app/modules/docs/docs.constants";
import { DocsController } from "@app/modules/docs/docs.controller";
import { OpenApiDocumentation } from "@app/modules/docs/docs.document";
import { DocsModule } from "@app/modules/docs/docs.module";
import type { OpenApiDocument } from "@app/modules/docs/docs.types";
import { EnginesModule } from "@app/modules/engines/engines.module";
import { HealthModule } from "@app/modules/health/health.module";
import { JobsModule } from "@app/modules/jobs/jobs.module";
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
import { TestHttpMethod } from "@test/fixtures/test.constants";
import type { LightMyRequestResponse } from "fastify";

/** Applications opened by the running test. */
const OpenApps: { app: NestFastifyApplication; harness: RuntimeHarness }[] = [];

/** Absolute paths of the documentation routes themselves. */
const DocsRoutes: readonly string[] = [
  `/${HttpRoute.docs}`,
  `/${HttpRoute.openapi}`,
];

/** Methods a documented operation can use. */
const DocumentedMethods: readonly string[] = [
  TestHttpMethod.delete,
  TestHttpMethod.get,
  TestHttpMethod.post,
];

/**
 * Boots every feature module and collects the routes Fastify registers.
 *
 * @returns {Promise<{ app: NestFastifyApplication; routes: Set<string> }>} Application and its route table.
 */
const bootAllModules = async (): Promise<{
  app: NestFastifyApplication;
  routes: Set<string>;
}> => {
  const harness: RuntimeHarness = createRuntimeHarness();
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      CoreModule.register(harness.runtime),
      DocsModule,
      EnginesModule,
      HealthModule,
      JobsModule,
      MetricsModule,
    ],
  }).compile();
  const adapter: FastifyAdapter = new FastifyAdapter({ logger: false });
  const routes: Set<string> = new Set<string>();
  // Registered before init so the hook observes every route Nest declares.
  adapter
    .getInstance()
    .addHook("onRoute", (route: { method: string | string[]; url: string }) => {
      const methods: readonly string[] = Array.isArray(route.method)
        ? route.method
        : [route.method];
      for (const method of methods) {
        if (DocumentedMethods.includes(method)) {
          routes.add(`${method} ${route.url}`);
        }
      }
    });
  const app: NestFastifyApplication =
    moduleRef.createNestApplication<NestFastifyApplication>(adapter);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  OpenApps.push({ app, harness });
  return { app, routes };
};

/**
 * Lists the operations the document declares, as method and path pairs.
 *
 * @param {OpenApiDocument} document - Served specification.
 * @returns {Set<string>} Documented operations.
 */
const documentedOperations = (document: OpenApiDocument): Set<string> => {
  const operations: Set<string> = new Set<string>();
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of DocumentedMethods) {
      if (item[method.toLowerCase() as "delete" | "get" | "post"]) {
        operations.add(`${method} ${path}`);
      }
    }
  }
  return operations;
};

/**
 * Rewrites a Fastify path into the OpenAPI template syntax.
 *
 * @param {string} route - Route as `METHOD /v1/jobs/:id`.
 * @returns {string} Route with templated parameters.
 */
const toTemplate = (route: string): string =>
  route.replaceAll(/:([A-Za-z]+)/g, "{$1}");

/**
 * Orders two routes so both sides of the comparison line up.
 *
 * @param {string} left - First route.
 * @param {string} right - Second route.
 * @returns {number} Standard comparator result.
 */
const byRoute = (left: string, right: string): number =>
  left.localeCompare(right);

afterEach(async (): Promise<void> => {
  const opened: { app: NestFastifyApplication; harness: RuntimeHarness }[] =
    OpenApps.splice(0, OpenApps.length);
  for (const entry of opened) {
    await entry.app.close();
    await entry.harness.dispose();
  }
});

describe("openapi document", (): void => {
  test("describes exactly the routes the application registers", async (): Promise<void> => {
    const booted: { app: NestFastifyApplication; routes: Set<string> } =
      await bootAllModules();
    const registered: readonly string[] = [...booted.routes]
      .map(toTemplate)
      .filter(
        (route: string): boolean =>
          !DocsRoutes.some((docs: string): boolean => route.endsWith(docs)),
      )
      .sort(byRoute);
    const documented: readonly string[] = [
      ...documentedOperations(OpenApiDocumentation),
    ].sort(byRoute);
    expect(registered).toEqual(documented);
  });

  test("resolves every schema reference it emits", (): void => {
    const serialized: string = JSON.stringify(OpenApiDocumentation);
    const published: readonly string[] = Object.keys(
      OpenApiDocumentation.components.schemas,
    );
    const referenced: readonly string[] = [
      ...new Set(
        [
          ...serialized.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g),
        ].map((match: RegExpMatchArray): string => match[1] ?? ""),
      ),
    ];
    for (const name of referenced) {
      expect(published).toContain(name);
    }
    expect(referenced.length).toBeGreaterThan(0);
  });

  test("serves the document without credentials", async (): Promise<void> => {
    const booted: { app: NestFastifyApplication; routes: Set<string> } =
      await bootAllModules();
    const response: LightMyRequestResponse = await booted.app.inject({
      method: TestHttpMethod.get,
      url: `/${HttpRoute.openapi}`,
    });
    const body: OpenApiDocument = response.json<OpenApiDocument>();
    expect(response.statusCode).toBe(200);
    expect(body.openapi).toBe(OpenApiDocumentation.openapi);
    expect(Object.keys(body.paths)).toEqual(
      Object.keys(OpenApiDocumentation.paths),
    );
  });

  test("serves the reference page without credentials", async (): Promise<void> => {
    const booted: { app: NestFastifyApplication; routes: Set<string> } =
      await bootAllModules();
    const response: LightMyRequestResponse = await booted.app.inject({
      method: TestHttpMethod.get,
      url: `/${HttpRoute.docs}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers[HttpHeader.contentType]).toContain(
      DocsMediaType.html,
    );
    expect(response.body).toContain(DocsUi.bundleIntegrity);
    expect(response.body).toContain(`/${HttpRoute.openapi}`);
  });

  test("returns the same document instance on every call", (): void => {
    const controller: DocsController = new DocsController();
    expect(controller.document()).toBe(OpenApiDocumentation);
  });
});
