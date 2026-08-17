/** OpenAPI specification version the document declares. */
const OpenApiVersion: string = "3.1.0";

/** JSON Schema keyword introducing a reference, spelled as the spec requires. */
const OpenApiRefKey = "$ref" as const;

/** Location the generated component schemas are referenced from. */
const OpenApiDefinitionPath: string = "#/components/schemas/";

/** JSON Schema dialect Effect targets when generating the component schemas. */
const OpenApiTarget = "openApi3.1" as const;

/** Document metadata shown at the top of the rendered reference. */
const DocsInfo = {
  description:
    "Asynchronous image generation. A job is accepted immediately, sampled by " +
    "an inference engine, and polled until it reaches a terminal status.",
  title: "Image Generation Orchestrator",
  version: "1.0.0",
} as const;

/** Security scheme name referenced by every protected operation. */
const DocsSecurityScheme = {
  bearerFormat: "opaque",
  name: "bearerAuth",
  scheme: "bearer",
  type: "http",
} as const;

/** Groups the operations are listed under. */
const DocsTag = {
  engines: "Engines",
  health: "Health",
  jobs: "Jobs",
  metrics: "Metrics",
} as const;

/** What each group covers. */
const DocsTagDescription = {
  engines: "Inference engines the scheduler can reach.",
  health: "Unauthenticated probes for container runtimes and load balancers.",
  jobs: "Submitting, following and cancelling generations.",
  metrics: "Queue and engine counters.",
} as const;

/** Stable operation identifiers client generators use as method names. */
const DocsOperationId = {
  cancelJob: "cancelJob",
  createJob: "createJob",
  getJob: "getJob",
  getResult: "getResult",
  healthLive: "healthLive",
  healthReady: "healthReady",
  listEngines: "listEngines",
  metrics: "getMetrics",
} as const;

/** Media types the document references. */
const DocsMediaType = {
  html: "text/html",
  imageAny: "image/*",
  json: "application/json",
} as const;

/** Response status codes described by the document. */
const DocsStatus = {
  accepted: "202",
  badRequest: "400",
  conflict: "409",
  created: "201",
  notFound: "404",
  ok: "200",
  serviceUnavailable: "503",
  tooManyRequests: "429",
  unauthorized: "401",
} as const;

/** Component schema names the operations reference. */
const DocsSchemaName = {
  engineList: "EngineList",
  engineView: "EngineView",
  error: "PublicError",
  healthLive: "HealthLive",
  healthReady: "HealthReady",
  job: "Job",
  jobCreateRequest: "JobCreateRequest",
  metrics: "Metrics",
} as const;

/** Operation summaries, kept out of the document builder. */
const DocsSummary = {
  cancelJob: "Cancel a job",
  createJob: "Create a generation job",
  getJob: "Get job state and results",
  getResult: "Download a generated image",
  healthLive: "Liveness probe",
  healthReady: "Readiness probe",
  listEngines: "List engine states",
  metrics: "Get platform metrics",
} as const;

/** Operation descriptions explaining the parts a summary cannot carry. */
const DocsOperation = {
  authentication:
    "Every /v1 route requires the platform API key as a bearer token. The " +
    "health probes are the only unauthenticated routes.",
  cancelJob:
    "Cancels a queued job immediately, or records a cancellation request that " +
    "the dispatcher forwards to the engine on its next poll. Always returns " +
    "the job, whose status may still be running until the engine acknowledges.",
  createJob:
    "Accepts the request into the durable queue and returns immediately. The " +
    "job starts in the queued status; poll it to follow progress.",
  getJob:
    "Returns the durable job state. resultUrls is populated once the status " +
    "reaches succeeded, and progress is present only while an engine that " +
    "reports sampling steps is running the job.",
  getResult:
    "Streams one generated image. The response carries a strong ETag built " +
    "from the file digest and an immutable cache directive, so a result can " +
    "be cached indefinitely.",
  healthLive:
    "Reports process liveness without touching storage or engines. " +
    "Unauthenticated, so a container runtime can probe it.",
  healthReady:
    "Probes durable storage and every configured engine. Fails while no " +
    "engine can serve a generation, which keeps traffic away during startup.",
  listEngines:
    "Lists the engines the scheduler can see, with their health and current " +
    "load. Neither prompts nor credentials are exposed.",
  metrics:
    "Returns bounded queue and engine counters. No user content and no " +
    "per-job cardinality, so the response is safe to scrape.",
} as const;

/** Response descriptions shared by several operations. */
const DocsResponse = {
  accepted: "Cancellation accepted.",
  badRequest: "The request body or a path parameter failed validation.",
  conflict: "The job is already terminal and cannot be cancelled.",
  created: "The job was queued.",
  engineList: "Engine states visible to the scheduler.",
  healthLive: "The process is running.",
  healthReady: "Storage is reachable and at least one engine can generate.",
  job: "Current durable job state.",
  metrics: "Current queue and engine counters.",
  notFound: "No such job, or no result at that index.",
  result: "The generated image.",
  serviceUnavailable:
    "Storage or every engine is unavailable, or the queue is full.",
  tooManyRequests:
    "The caller exceeded its rate limit. Retry after the advertised delay.",
  unauthorized: "The bearer token is missing or invalid.",
} as const;

/** Parameter descriptions. */
const DocsParameter = {
  jobId: "Identifier returned when the job was created.",
  resultIndex: "Zero-based index of the image within the job results.",
} as const;

/** Field descriptions carried into the generated component schemas. */
const DocsDescription = {
  cancelRequested: "Whether a cancellation was requested and not yet applied.",
  createdAt: "ISO 8601 instant the job entered the queue.",
  engine: "Scheduler-visible state of one configured engine.",
  engineHealth:
    "healthy accepts work, degraded is failing its circuit breaker, offline " +
    "is unreachable.",
  engineModels: "Models this engine can serve.",
  enginesAvailable: "Number of engines that can currently serve a generation.",
  error: "Uniform error body returned by every failing route.",
  errorCode: "Stable machine-readable code, safe to branch on.",
  errorMessage: "Human-readable summary, never carrying internal details.",
  healthLive: "Liveness probe body.",
  healthReady: "Readiness probe body.",
  job: "Public representation of one generation job.",
  jobError: "Failure that made the job terminal, null until then.",
  jobId: "Durable job identifier.",
  maxConcurrent: "Generations this engine runs in parallel.",
  metrics: "Bounded operational counters.",
  progress:
    "Sampling progress across the whole job, null until an engine reports it. " +
    "Requires an engine built with the progress patches.",
  progressCompleted: "Sampling steps finished across every image of the job.",
  progressTotal: "Sampling steps the whole job is expected to run.",
  queuedJobs: "Jobs waiting for an engine.",
  resultUrls: "Result routes, populated once the job succeeds.",
  retryAfterSeconds: "Delay before the caller should retry.",
  running: "Generations this engine is running right now.",
  startedAt: "ISO 8601 instant an engine began the job, null while queued.",
  updatedAt: "ISO 8601 instant of the last durable change.",
} as const;

/**
 * Swagger UI is loaded from a CDN rather than vendored.
 *
 * The application ships as a single compiled executable, so serving the UI
 * assets would mean embedding a few megabytes of JavaScript in the binary and
 * carrying a static-file route. The machine-readable document at the OpenAPI
 * route is the contract; this page is only a convenience, and an air-gapped
 * deployment can point any local viewer at that route instead.
 *
 * The version is pinned and both assets carry a subresource integrity digest:
 * the page accepts an API key in its authorize dialog, so a swapped script
 * would be handed live credentials. Bumping the version means recomputing both
 * digests with `openssl dgst -sha384 -binary <file> | openssl base64 -A`.
 */
const DocsUi = {
  bundleIntegrity:
    "sha384-PsJla434CobCNv3y1K4wRavOqkUAvwGEQEfbUmI98CCqqGCJsmuDsgIjM6ZQQODP",
  bundleUrl:
    "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.13/swagger-ui-bundle.js",
  stylesheetIntegrity:
    "sha384-tRpWwikYYdk1+1Mu0osh0Tz/Ay5xgS+s/Nf2Aa7GVAFtZLFdJlAbozfrq4g+xHBK",
  stylesheetUrl:
    "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.32.13/swagger-ui.css",
  title: `${DocsInfo.title} API`,
} as const;

export {
  DocsDescription,
  DocsInfo,
  DocsMediaType,
  DocsOperation,
  DocsOperationId,
  DocsParameter,
  DocsResponse,
  DocsSchemaName,
  DocsSecurityScheme,
  DocsStatus,
  DocsSummary,
  DocsTag,
  DocsTagDescription,
  DocsUi,
  OpenApiDefinitionPath,
  OpenApiRefKey,
  OpenApiTarget,
  OpenApiVersion,
};
