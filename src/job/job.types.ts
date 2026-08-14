import { Schema } from "effect";

import {
  JOB_SCHEMA_LIMITS,
  JOB_STATUS,
  OUTPUT_FORMAT,
} from "@app/job/job.constants.js";

/** Public image-generation request accepted by the platform. */
interface JobCreateRequest {
  readonly cfgScale: number;
  readonly count: number;
  readonly height: number;
  readonly model: string;
  readonly negativePrompt?: string;
  readonly outputFormat?: OutputFormat;
  readonly prompt: string;
  readonly seed?: number;
  readonly steps: number;
  readonly width: number;
}

/** Persistent state machine status for one generation job. */
type JobStatus = (typeof JOB_STATUS)[keyof typeof JOB_STATUS];

/** Output image format supported by the public contract. */
type OutputFormat = (typeof OUTPUT_FORMAT)[keyof typeof OUTPUT_FORMAT];

/** Durable representation of one accepted job. */
interface Job {
  readonly attempt: number;
  readonly cancelRequested: boolean;
  readonly cost: number;
  readonly createdAt: string;
  readonly engineId?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly id: string;
  readonly leaseUntil?: string;
  readonly remoteJobId?: string;
  readonly request: JobCreateRequest;
  readonly status: JobStatus;
  readonly updatedAt: string;
}

/** Persisted metadata describing one generated result file. */
interface JobResult {
  readonly index: number;
  readonly jobId: string;
  readonly mimeType: string;
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** Minimal queue head used by the dispatcher before reserving an engine. */
interface QueuedJobHead {
  readonly id: string;
  readonly model: string;
}

/** Safe caller-facing failure descriptor independent of infrastructure details. */
interface JobResponseError {
  readonly code: string;
  readonly message: string;
}

/** Public job response with internal scheduler and engine metadata removed. */
interface JobResponse {
  readonly cancelRequested: boolean;
  readonly createdAt: string;
  readonly error: JobResponseError | null;
  readonly id: string;
  readonly request: JobCreateRequest;
  readonly resultUrls: readonly string[];
  readonly status: JobStatus;
  readonly updatedAt: string;
}

/** Effect Schema for a persisted job status. */
const JobStatusSchema: Schema.Schema<JobStatus> = Schema.Literal(
  JOB_STATUS.CANCELLED,
  JOB_STATUS.FAILED,
  JOB_STATUS.QUEUED,
  JOB_STATUS.RUNNING,
  JOB_STATUS.SUCCEEDED,
);

/** Effect Schema for an explicit public generation request. */
const JobCreateRequestSchema: Schema.Schema<JobCreateRequest> = Schema.Struct({
  cfgScale: Schema.Number.pipe(
    Schema.between(
      JOB_SCHEMA_LIMITS.CFG_SCALE_MIN,
      JOB_SCHEMA_LIMITS.CFG_SCALE_MAX,
    ),
  ),
  count: Schema.Int.pipe(
    Schema.between(JOB_SCHEMA_LIMITS.COUNT_MIN, JOB_SCHEMA_LIMITS.COUNT_MAX),
  ),
  height: Schema.Int.pipe(
    Schema.between(
      JOB_SCHEMA_LIMITS.DIMENSION_MIN,
      JOB_SCHEMA_LIMITS.DIMENSION_MAX,
    ),
  ),
  model: Schema.NonEmptyString,
  negativePrompt: Schema.optional(Schema.String),
  outputFormat: Schema.optional(
    Schema.Literal(OUTPUT_FORMAT.JPEG, OUTPUT_FORMAT.PNG, OUTPUT_FORMAT.WEBP),
  ),
  prompt: Schema.NonEmptyString,
  seed: Schema.optional(Schema.NonNegativeInt),
  steps: Schema.Int.pipe(
    Schema.between(JOB_SCHEMA_LIMITS.STEPS_MIN, JOB_SCHEMA_LIMITS.STEPS_MAX),
  ),
  width: Schema.Int.pipe(
    Schema.between(
      JOB_SCHEMA_LIMITS.DIMENSION_MIN,
      JOB_SCHEMA_LIMITS.DIMENSION_MAX,
    ),
  ),
});

export type {
  Job,
  JobCreateRequest,
  JobResponse,
  JobResult,
  JobResponseError,
  JobStatus,
  OutputFormat,
  QueuedJobHead,
};
export { JobCreateRequestSchema, JobStatusSchema };
