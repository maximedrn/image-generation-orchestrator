import { Schema } from "effect";

import {
  STABLE_DIFFUSION_HTTP,
  STABLE_DIFFUSION_JOB_KIND,
  STABLE_DIFFUSION_JOB_STATUS,
} from "@app/engine/stable-diffusion.constants.js";
import { OUTPUT_FORMAT } from "@app/job/job.constants.js";
import type { OutputFormat } from "@app/job/job.types.js";

/** Native stable-diffusion.cpp image generation request subset used by the adapter. */
interface StableDiffusionImageGenerationRequest {
  readonly batch_count: number;
  readonly height: number;
  readonly negative_prompt: string;
  readonly output_format: OutputFormat;
  readonly prompt: string;
  readonly sample_params: {
    readonly guidance: {
      readonly txt_cfg: number;
    };
    readonly sample_steps: number;
  };
  readonly seed: number;
  readonly width: number;
}

/** Native stable-diffusion.cpp capability subset required by the platform. */
interface StableDiffusionCapabilities {
  readonly output_formats_by_mode: Readonly<Record<string, readonly string[]>>;
  readonly supported_modes: readonly string[];
}

/** Native asynchronous image submission response. */
interface StableDiffusionJobSubmission {
  readonly created: number;
  readonly id: string;
  readonly kind: StableDiffusionJobKind;
  readonly poll_url: string;
  readonly status: typeof STABLE_DIFFUSION_JOB_STATUS.QUEUED;
}

/** One native base64 image returned by stable-diffusion.cpp. */
interface StableDiffusionImageResult {
  readonly b64_json: string;
  readonly index: number;
}

/** Native completed image result payload. */
interface StableDiffusionImageResultSet {
  readonly images: readonly StableDiffusionImageResult[];
  readonly output_format: OutputFormat;
}

/** Native structured stable-diffusion.cpp error. */
interface StableDiffusionJobError {
  readonly code: string;
  readonly message: string;
}

/** Native asynchronous stable-diffusion.cpp job representation. */
interface StableDiffusionJob {
  readonly completed: number | null;
  readonly created: number;
  readonly error: StableDiffusionJobError | null;
  readonly id: string;
  readonly kind: StableDiffusionJobKind;
  readonly queue_position: number;
  readonly result: StableDiffusionImageResultSet | null;
  readonly started: number | null;
  readonly status: StableDiffusionJobStatus;
}

/** Supported adapter HTTP method literal union. */
type StableDiffusionHttpMethod =
  | typeof STABLE_DIFFUSION_HTTP.METHOD_GET
  | typeof STABLE_DIFFUSION_HTTP.METHOD_POST;

/** Native asynchronous job status literal union. */
type StableDiffusionJobStatus =
  (typeof STABLE_DIFFUSION_JOB_STATUS)[keyof typeof STABLE_DIFFUSION_JOB_STATUS];

/** Native job kind literal union consumed by this adapter. */
type StableDiffusionJobKind =
  (typeof STABLE_DIFFUSION_JOB_KIND)[keyof typeof STABLE_DIFFUSION_JOB_KIND];

/** Explicit schema for the native capability subset required by readiness. */
const StableDiffusionCapabilitiesSchema: Schema.Schema<StableDiffusionCapabilities> =
  Schema.Struct({
    output_formats_by_mode: Schema.Record({
      key: Schema.String,
      value: Schema.Array(Schema.NonEmptyString),
    }),
    supported_modes: Schema.Array(Schema.NonEmptyString),
  });

/** Explicit schema for one native asynchronous submission. */
const StableDiffusionJobSubmissionSchema: Schema.Schema<StableDiffusionJobSubmission> =
  Schema.Struct({
    created: Schema.Int,
    id: Schema.NonEmptyString,
    kind: Schema.Literal(STABLE_DIFFUSION_JOB_KIND.IMAGE_GENERATION),
    poll_url: Schema.NonEmptyString,
    status: Schema.Literal(STABLE_DIFFUSION_JOB_STATUS.QUEUED),
  });

/** Explicit schema for one native completed image. */
const StableDiffusionImageResultSchema: Schema.Schema<StableDiffusionImageResult> =
  Schema.Struct({
    b64_json: Schema.NonEmptyString,
    index: Schema.NonNegativeInt,
  });

/** Explicit schema for one native completed image result set. */
const StableDiffusionImageResultSetSchema: Schema.Schema<StableDiffusionImageResultSet> =
  Schema.Struct({
    images: Schema.Array(StableDiffusionImageResultSchema),
    output_format: Schema.Literal(
      OUTPUT_FORMAT.JPEG,
      OUTPUT_FORMAT.PNG,
      OUTPUT_FORMAT.WEBP,
    ),
  });

/** Explicit schema for one native structured engine error. */
const StableDiffusionJobErrorSchema: Schema.Schema<StableDiffusionJobError> =
  Schema.Struct({
    code: Schema.NonEmptyString,
    message: Schema.String,
  });

/** Explicit schema for the native asynchronous job payload. */
const StableDiffusionJobSchema: Schema.Schema<StableDiffusionJob> = Schema.Struct({
  completed: Schema.NullOr(Schema.Int),
  created: Schema.Int,
  error: Schema.NullOr(StableDiffusionJobErrorSchema),
  id: Schema.NonEmptyString,
  kind: Schema.Literal(STABLE_DIFFUSION_JOB_KIND.IMAGE_GENERATION),
  queue_position: Schema.NonNegativeInt,
  result: Schema.NullOr(StableDiffusionImageResultSetSchema),
  started: Schema.NullOr(Schema.Int),
  status: Schema.Literal(
    STABLE_DIFFUSION_JOB_STATUS.CANCELLED,
    STABLE_DIFFUSION_JOB_STATUS.COMPLETED,
    STABLE_DIFFUSION_JOB_STATUS.FAILED,
    STABLE_DIFFUSION_JOB_STATUS.GENERATING,
    STABLE_DIFFUSION_JOB_STATUS.QUEUED,
  ),
});

export type {
  StableDiffusionCapabilities,
  StableDiffusionHttpMethod,
  StableDiffusionImageGenerationRequest,
  StableDiffusionImageResult,
  StableDiffusionImageResultSet,
  StableDiffusionJob,
  StableDiffusionJobError,
  StableDiffusionJobKind,
  StableDiffusionJobStatus,
  StableDiffusionJobSubmission,
};
export {
  StableDiffusionCapabilitiesSchema,
  StableDiffusionImageResultSchema,
  StableDiffusionImageResultSetSchema,
  StableDiffusionJobErrorSchema,
  StableDiffusionJobSchema,
  StableDiffusionJobSubmissionSchema,
};
