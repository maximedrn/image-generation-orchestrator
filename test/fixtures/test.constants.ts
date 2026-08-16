import { ConfigEnvironment } from "@app/core/config/config.constants";
import { HttpRoute } from "@app/core/http/http.constants";
import {
  AuthScheme,
  AuthSchemeSeparator,
  BearerAuth,
} from "@app/core/security/security.constants";
import { OutputMimeType } from "@app/modules/jobs/job.constants";

/**
 * Values shared by more than one suite.
 *
 * Error tags and public error codes deliberately live in `src` and are imported
 * from there (`ErrorTag`, `HttpErrorCode`): an assertion has to break when the
 * production vocabulary changes, which a copy in the test tree would hide.
 */

/** HTTP verbs used when injecting requests into the Fastify adapter. */
const TestHttpMethod = {
  delete: "DELETE",
  get: "GET",
  post: "POST",
} as const;

/** Absolute public paths, derived from the routes the controllers declare. */
const TestRoute = {
  healthLive: `/${HttpRoute.healthLive}`,
  healthReady: `/${HttpRoute.healthReady}`,
  jobCollection: `/${HttpRoute.jobCollection}`,
} as const;

/** Base64 payloads standing in for generated images. */
const TestImagePayload = {
  hello: "aGVsbG8=",
  short: "aGk=",
} as const;

/** Remote inference identifiers handed back by the fake engines. */
const TestRemoteJobId = {
  adapter: "remote-7",
  dispatch: "remote-dispatch-1",
  endToEnd: "remote-e2e-1",
  router: "remote-1",
} as const;

/** Deterministic instants used by lease and timestamp assertions. */
const TestInstant = {
  created: "2026-08-14T12:00:00.000Z",
  farFuture: "2099-01-01T00:00:00.000Z",
  leaseRenewed: "2026-08-14T12:02:00.000Z",
} as const;

/** Secret the fixture configuration authenticates against. */
const TestSecret: string = "test-secret";

/** Caller identities and secrets exercised by admission and authorization. */
const TestCaller = {
  apiKeyVariable: ConfigEnvironment.apiKey,
  arbitrarySecret: "secret",
  bearerHeader: `${BearerAuth.prefix}${TestSecret}`,
  rateLimitKey: "client-a",
  secret: TestSecret,
} as const;

/** Authorization headers a caller may present, valid or not. */
const TestAuthorization = {
  basic: `${AuthScheme.basic}${AuthSchemeSeparator}${btoa("user:pass")}`,
  bearerWrongSecret: `${BearerAuth.prefix}not-the-secret`,
} as const;

/** Failure messages injected to force an explicit error channel. */
const TestFailureMessage = {
  databaseGone: "database is gone",
  databaseLocked: "database is locked",
  engineDown: "engine is down",
} as const;

/** Artefact names and media types shared by storage and download suites. */
const TestArtefact = {
  digest: "sha",
  modelFileName: "model.safetensors",
  pngMimeType: OutputMimeType.png,
} as const;

export {
  TestArtefact,
  TestAuthorization,
  TestCaller,
  TestFailureMessage,
  TestHttpMethod,
  TestImagePayload,
  TestInstant,
  TestRemoteJobId,
  TestRoute,
};
