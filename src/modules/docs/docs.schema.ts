import {
  EngineBackend,
  EngineProvider,
} from "@app/core/config/config.constants";
import type {
  HealthLiveResponse,
  HealthReadyResponse,
  MetricsResponse,
  PublicErrorResponse,
} from "@app/core/http/http.types";
import { EngineHealth } from "@app/infrastructure/engine/engine.constants";
import type { EngineView } from "@app/infrastructure/engine/engine.types";
import { DocsDescription } from "@app/modules/docs/docs.constants";
import { HealthStatus } from "@app/modules/health/health.constants";
import {
  JobCreateRequestSchema,
  JobStatusSchema,
} from "@app/modules/jobs/job.schema";
import type {
  JobProgress,
  JobResponse,
  JobResponseError,
} from "@app/modules/jobs/job.types";
import { Schema } from "effect";

/**
 * Effect Schemas describing every public response body.
 *
 * They exist to derive the OpenAPI document, not to validate at runtime: the
 * responses are produced by the platform itself. Annotating each one with its
 * domain interface is what makes the contract trustworthy, since a field added
 * to a response type without being described here stops the build.
 */

/** Sampling progress of a running job. */
const JobProgressSchema: Schema.Schema<JobProgress> = Schema.Struct({
  completed: Schema.Number.annotations({
    description: DocsDescription.progressCompleted,
  }),
  total: Schema.Number.annotations({
    description: DocsDescription.progressTotal,
  }),
}).annotations({ description: DocsDescription.progress });

/** Caller-facing failure attached to a terminal job. */
const JobResponseErrorSchema: Schema.Schema<JobResponseError> = Schema.Struct({
  code: Schema.String.annotations({ description: DocsDescription.errorCode }),
  message: Schema.String.annotations({
    description: DocsDescription.errorMessage,
  }),
}).annotations({ description: DocsDescription.jobError });

/** Public job representation returned by every job route. */
const JobResponseSchema: Schema.Schema<JobResponse> = Schema.Struct({
  cancelRequested: Schema.Boolean.annotations({
    description: DocsDescription.cancelRequested,
  }),
  createdAt: Schema.String.annotations({
    description: DocsDescription.createdAt,
  }),
  error: Schema.NullOr(JobResponseErrorSchema),
  id: Schema.String.annotations({ description: DocsDescription.jobId }),
  progress: Schema.NullOr(JobProgressSchema),
  request: JobCreateRequestSchema,
  resultUrls: Schema.Array(Schema.String).annotations({
    description: DocsDescription.resultUrls,
  }),
  startedAt: Schema.NullOr(Schema.String).annotations({
    description: DocsDescription.startedAt,
  }),
  status: JobStatusSchema,
  updatedAt: Schema.String.annotations({
    description: DocsDescription.updatedAt,
  }),
}).annotations({ description: DocsDescription.job });

/** Scheduler-visible state of one configured engine. */
const EngineViewSchema: Schema.Schema<EngineView> = Schema.Struct({
  backend: Schema.Literal(
    EngineBackend.cpu,
    EngineBackend.cuda,
    EngineBackend.metal,
    EngineBackend.rocm,
    EngineBackend.vulkan,
  ),
  health: Schema.Literal(
    EngineHealth.degraded,
    EngineHealth.healthy,
    EngineHealth.offline,
  ).annotations({ description: DocsDescription.engineHealth }),
  id: Schema.String,
  maxConcurrent: Schema.Number.annotations({
    description: DocsDescription.maxConcurrent,
  }),
  models: Schema.Array(Schema.String).annotations({
    description: DocsDescription.engineModels,
  }),
  provider: Schema.Literal(EngineProvider.stableDiffusionCpp),
  running: Schema.Number.annotations({ description: DocsDescription.running }),
}).annotations({ description: DocsDescription.engine });

/** Engine list returned by the engine registry route. */
const EngineListSchema: Schema.Schema<readonly EngineView[]> =
  Schema.Array(EngineViewSchema);

/** Bounded operational metrics. */
const MetricsResponseSchema: Schema.Schema<MetricsResponse> = Schema.Struct({
  engines: EngineListSchema,
  queuedJobs: Schema.Number.annotations({
    description: DocsDescription.queuedJobs,
  }),
}).annotations({ description: DocsDescription.metrics });

/** Liveness probe body. */
const HealthLiveResponseSchema: Schema.Schema<HealthLiveResponse> =
  Schema.Struct({
    status: Schema.Literal(HealthStatus.live),
  }).annotations({ description: DocsDescription.healthLive });

/** Readiness probe body. */
const HealthReadyResponseSchema: Schema.Schema<HealthReadyResponse> =
  Schema.Struct({
    enginesAvailable: Schema.Number.annotations({
      description: DocsDescription.enginesAvailable,
    }),
    status: Schema.Literal(HealthStatus.ready),
  }).annotations({ description: DocsDescription.healthReady });

/** Uniform error body returned by every failing route. */
const PublicErrorResponseSchema: Schema.Schema<PublicErrorResponse> =
  Schema.Struct({
    code: Schema.String.annotations({ description: DocsDescription.errorCode }),
    message: Schema.String.annotations({
      description: DocsDescription.errorMessage,
    }),
    retryAfterSeconds: Schema.optionalWith(
      Schema.Number.annotations({
        description: DocsDescription.retryAfterSeconds,
      }),
      { exact: true },
    ),
  }).annotations({ description: DocsDescription.error });

export {
  EngineListSchema,
  EngineViewSchema,
  HealthLiveResponseSchema,
  HealthReadyResponseSchema,
  JobProgressSchema,
  JobResponseErrorSchema,
  JobResponseSchema,
  MetricsResponseSchema,
  PublicErrorResponseSchema,
};
