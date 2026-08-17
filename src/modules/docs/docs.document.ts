import {
  HttpParameter,
  HttpPathSeparator,
  HttpSegment,
} from "@app/core/http/http.constants";
import {
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
  OpenApiDefinitionPath,
  OpenApiRefKey,
  OpenApiTarget,
  OpenApiVersion,
} from "@app/modules/docs/docs.constants";
import {
  EngineListSchema,
  HealthLiveResponseSchema,
  HealthReadyResponseSchema,
  JobResponseSchema,
  MetricsResponseSchema,
  PublicErrorResponseSchema,
} from "@app/modules/docs/docs.schema";
import type {
  OpenApiContent,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiReference,
  OpenApiResponse,
  OpenApiSchema,
} from "@app/modules/docs/docs.types";
import { JobCreateRequestSchema } from "@app/modules/jobs/job.schema";
import { JSONSchema, type SchemaAST } from "effect";

/**
 * Shared JSON Schema definitions Effect factors out while generating.
 *
 * Filled as a side effect of every `componentSchema` call, then published
 * alongside the named schemas so the `$ref`s they emit resolve.
 */
const definitions: Record<string, JSONSchema.JsonSchema7> = {};

/**
 * Converts one Effect Schema into a component schema.
 *
 * @param {SchemaAST.AST} ast - Abstract syntax tree of the schema.
 * @returns {JSONSchema.JsonSchema7} Schema targeting the OpenAPI dialect.
 */
const componentSchema = (ast: SchemaAST.AST): JSONSchema.JsonSchema7 =>
  JSONSchema.fromAST(ast, {
    definitionPath: OpenApiDefinitionPath,
    definitions,
    target: OpenApiTarget,
  });

/**
 * References one published component schema.
 *
 * @param {string} name - Component schema name.
 * @returns {OpenApiReference} Reference usable as a schema.
 */
const reference = (name: string): OpenApiReference => ({
  [OpenApiRefKey]: `${OpenApiDefinitionPath}${name}`,
});

/**
 * Builds a JSON body carrying one published schema.
 *
 * @param {string} name - Component schema name.
 * @returns {OpenApiContent} Single-media-type content.
 */
const jsonContent = (name: string): OpenApiContent => ({
  [DocsMediaType.json]: { schema: reference(name) },
});

/**
 * Builds a JSON response carrying one published schema.
 *
 * @param {string} description - Response description.
 * @param {string} name - Component schema name.
 * @returns {OpenApiResponse} Documented response.
 */
const jsonResponse = (description: string, name: string): OpenApiResponse => ({
  content: jsonContent(name),
  description,
});

/**
 * Builds an error response, which always carries the uniform error body.
 *
 * @param {string} description - Condition producing this status.
 * @returns {OpenApiResponse} Documented error response.
 */
const errorResponse = (description: string): OpenApiResponse =>
  jsonResponse(description, DocsSchemaName.error);

/**
 * Joins path segments into an absolute OpenAPI path.
 *
 * Built from the same segments the controllers register, so a renamed route
 * cannot be documented under its former path.
 *
 * @param {readonly string[]} segments - Ordered path segments.
 * @returns {string} Absolute path.
 */
const path = (...segments: readonly string[]): string =>
  `${HttpPathSeparator}${segments.join(HttpPathSeparator)}`;

/**
 * Wraps a parameter name in the OpenAPI path template syntax.
 *
 * @param {string} name - Parameter name as registered by the controller.
 * @returns {string} Templated segment.
 */
const templated = (name: string): string => `{${name}}`;

/** Responses every authenticated operation can return. */
const ProtectedResponses = {
  [DocsStatus.tooManyRequests]: errorResponse(DocsResponse.tooManyRequests),
  [DocsStatus.unauthorized]: errorResponse(DocsResponse.unauthorized),
} as const;

/** Job identifier path parameter. */
const JobIdParameter: OpenApiParameter = {
  description: DocsParameter.jobId,
  in: "path",
  name: HttpParameter.jobId,
  required: true,
  schema: { type: "string" },
};

/** Result index path parameter. */
const ResultIndexParameter: OpenApiParameter = {
  description: DocsParameter.resultIndex,
  in: "path",
  name: HttpParameter.resultIndex,
  required: true,
  schema: { minimum: 0, type: "integer" },
};

/** Raw image payload returned by the result route. */
const BinarySchema: OpenApiSchema = { format: "binary", type: "string" };

/** Operations the document publishes, before schemas are attached. */
const createJobOperation: OpenApiOperation = {
  description: DocsOperation.createJob,
  operationId: DocsOperationId.createJob,
  requestBody: {
    content: jsonContent(DocsSchemaName.jobCreateRequest),
    required: true,
  },
  responses: {
    ...ProtectedResponses,
    [DocsStatus.badRequest]: errorResponse(DocsResponse.badRequest),
    [DocsStatus.created]: jsonResponse(
      DocsResponse.created,
      DocsSchemaName.job,
    ),
    [DocsStatus.serviceUnavailable]: errorResponse(
      DocsResponse.serviceUnavailable,
    ),
  },
  summary: DocsSummary.createJob,
  tags: [DocsTag.jobs],
};

/** Job read operation. */
const getJobOperation: OpenApiOperation = {
  description: DocsOperation.getJob,
  operationId: DocsOperationId.getJob,
  parameters: [JobIdParameter],
  responses: {
    ...ProtectedResponses,
    [DocsStatus.notFound]: errorResponse(DocsResponse.notFound),
    [DocsStatus.ok]: jsonResponse(DocsResponse.job, DocsSchemaName.job),
  },
  summary: DocsSummary.getJob,
  tags: [DocsTag.jobs],
};

/** Job cancellation operation. */
const cancelJobOperation: OpenApiOperation = {
  description: DocsOperation.cancelJob,
  operationId: DocsOperationId.cancelJob,
  parameters: [JobIdParameter],
  responses: {
    ...ProtectedResponses,
    [DocsStatus.accepted]: jsonResponse(
      DocsResponse.accepted,
      DocsSchemaName.job,
    ),
    [DocsStatus.conflict]: errorResponse(DocsResponse.conflict),
    [DocsStatus.notFound]: errorResponse(DocsResponse.notFound),
  },
  summary: DocsSummary.cancelJob,
  tags: [DocsTag.jobs],
};

/** Result download operation. */
const getResultOperation: OpenApiOperation = {
  description: DocsOperation.getResult,
  operationId: DocsOperationId.getResult,
  parameters: [JobIdParameter, ResultIndexParameter],
  responses: {
    ...ProtectedResponses,
    [DocsStatus.badRequest]: errorResponse(DocsResponse.badRequest),
    [DocsStatus.notFound]: errorResponse(DocsResponse.notFound),
    [DocsStatus.ok]: {
      content: { [DocsMediaType.imageAny]: { schema: BinarySchema } },
      description: DocsResponse.result,
    },
    [DocsStatus.serviceUnavailable]: errorResponse(
      DocsResponse.serviceUnavailable,
    ),
  },
  summary: DocsSummary.getResult,
  tags: [DocsTag.jobs],
};

/** Engine registry operation. */
const listEnginesOperation: OpenApiOperation = {
  description: DocsOperation.listEngines,
  operationId: DocsOperationId.listEngines,
  responses: {
    ...ProtectedResponses,
    [DocsStatus.ok]: jsonResponse(
      DocsResponse.engineList,
      DocsSchemaName.engineList,
    ),
  },
  summary: DocsSummary.listEngines,
  tags: [DocsTag.engines],
};

/** Metrics operation. */
const metricsOperation: OpenApiOperation = {
  description: DocsOperation.metrics,
  operationId: DocsOperationId.metrics,
  responses: {
    ...ProtectedResponses,
    [DocsStatus.ok]: jsonResponse(DocsResponse.metrics, DocsSchemaName.metrics),
  },
  summary: DocsSummary.metrics,
  tags: [DocsTag.metrics],
};

/** Liveness operation, reachable without credentials. */
const healthLiveOperation: OpenApiOperation = {
  description: DocsOperation.healthLive,
  operationId: DocsOperationId.healthLive,
  responses: {
    [DocsStatus.ok]: jsonResponse(
      DocsResponse.healthLive,
      DocsSchemaName.healthLive,
    ),
  },
  security: [],
  summary: DocsSummary.healthLive,
  tags: [DocsTag.health],
};

/** Readiness operation, reachable without credentials. */
const healthReadyOperation: OpenApiOperation = {
  description: DocsOperation.healthReady,
  operationId: DocsOperationId.healthReady,
  responses: {
    [DocsStatus.ok]: jsonResponse(
      DocsResponse.healthReady,
      DocsSchemaName.healthReady,
    ),
    [DocsStatus.serviceUnavailable]: errorResponse(
      DocsResponse.serviceUnavailable,
    ),
  },
  security: [],
  summary: DocsSummary.healthReady,
  tags: [DocsTag.health],
};

/**
 * Named component schemas, generated before the shared definitions are read.
 *
 * Evaluating this object is what fills `definitions`, so it must be built
 * before the components section spreads them.
 */
const namedSchemas: { readonly [name: string]: OpenApiSchema } = {
  [DocsSchemaName.engineList]: componentSchema(EngineListSchema.ast),
  [DocsSchemaName.error]: componentSchema(PublicErrorResponseSchema.ast),
  [DocsSchemaName.healthLive]: componentSchema(HealthLiveResponseSchema.ast),
  [DocsSchemaName.healthReady]: componentSchema(HealthReadyResponseSchema.ast),
  [DocsSchemaName.job]: componentSchema(JobResponseSchema.ast),
  [DocsSchemaName.jobCreateRequest]: componentSchema(
    JobCreateRequestSchema.ast,
  ),
  [DocsSchemaName.metrics]: componentSchema(MetricsResponseSchema.ast),
};

/** Complete document describing every public route. */
const OpenApiDocumentation: OpenApiDocument = {
  components: {
    schemas: { ...definitions, ...namedSchemas },
    securitySchemes: {
      [DocsSecurityScheme.name]: {
        bearerFormat: DocsSecurityScheme.bearerFormat,
        description: DocsOperation.authentication,
        scheme: DocsSecurityScheme.scheme,
        type: DocsSecurityScheme.type,
      },
    },
  },
  info: DocsInfo,
  openapi: OpenApiVersion,
  paths: {
    [path(HttpSegment.apiVersion, HttpSegment.engines)]: {
      get: listEnginesOperation,
    },
    [path(HttpSegment.apiVersion, HttpSegment.jobs)]: {
      post: createJobOperation,
    },
    [path(
      HttpSegment.apiVersion,
      HttpSegment.jobs,
      templated(HttpParameter.jobId),
    )]: { delete: cancelJobOperation, get: getJobOperation },
    [path(
      HttpSegment.apiVersion,
      HttpSegment.jobs,
      templated(HttpParameter.jobId),
      HttpSegment.results,
      templated(HttpParameter.resultIndex),
    )]: { get: getResultOperation },
    [path(HttpSegment.apiVersion, HttpSegment.metrics)]: {
      get: metricsOperation,
    },
    [path(HttpSegment.health, HttpSegment.live)]: { get: healthLiveOperation },
    [path(HttpSegment.health, HttpSegment.ready)]: {
      get: healthReadyOperation,
    },
  },
  security: [{ [DocsSecurityScheme.name]: [] }],
  tags: [
    { description: DocsTagDescription.engines, name: DocsTag.engines },
    { description: DocsTagDescription.health, name: DocsTag.health },
    { description: DocsTagDescription.jobs, name: DocsTag.jobs },
    { description: DocsTagDescription.metrics, name: DocsTag.metrics },
  ],
};

export { OpenApiDocumentation };
