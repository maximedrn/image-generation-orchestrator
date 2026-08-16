import {
  JobSchemaLimits,
  JobStatus,
  OutputFormat,
} from "@app/modules/jobs/job.constants";
import type {
  JobCreateRequest,
  JobStatusValue,
} from "@app/modules/jobs/job.types";
import { Schema } from "effect";

/** Effect Schema for a persisted job status. */
const JobStatusSchema: Schema.Schema<JobStatusValue> = Schema.Literal(
  JobStatus.cancelled,
  JobStatus.failed,
  JobStatus.queued,
  JobStatus.running,
  JobStatus.succeeded,
);

/** Effect Schema for an explicit public generation request. */
const JobCreateRequestSchema: Schema.Schema<
  JobCreateRequest,
  JobCreateRequest
> = Schema.Struct({
  cfgScale: Schema.Number.pipe(
    Schema.between(JobSchemaLimits.cfgScaleMin, JobSchemaLimits.cfgScaleMax),
  ),
  count: Schema.Int.pipe(
    Schema.between(JobSchemaLimits.countMin, JobSchemaLimits.countMax),
  ),
  height: Schema.Int.pipe(
    Schema.between(JobSchemaLimits.dimensionMin, JobSchemaLimits.dimensionMax),
  ),
  model: Schema.NonEmptyString,
  negativePrompt: Schema.optionalWith(Schema.String, { exact: true }),
  outputFormat: Schema.optionalWith(
    Schema.Literal(OutputFormat.jpeg, OutputFormat.png, OutputFormat.webp),
    { exact: true },
  ),
  prompt: Schema.NonEmptyString,
  seed: Schema.optionalWith(Schema.NonNegativeInt, { exact: true }),
  steps: Schema.Int.pipe(
    Schema.between(JobSchemaLimits.stepsMin, JobSchemaLimits.stepsMax),
  ),
  width: Schema.Int.pipe(
    Schema.between(JobSchemaLimits.dimensionMin, JobSchemaLimits.dimensionMax),
  ),
});

export { JobCreateRequestSchema, JobStatusSchema };
