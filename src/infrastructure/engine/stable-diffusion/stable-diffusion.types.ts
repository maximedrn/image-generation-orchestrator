import {
  type StableDiffusionHttp,
  StableDiffusionJobKind,
  StableDiffusionJobStatus,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.constants";
import { OutputFormat } from "@app/modules/jobs/job.constants";
import type { OutputFormatValue } from "@app/modules/jobs/job.types";
import { Schema } from "effect";

/** Native stable-diffusion.cpp image generation request subset used by the adapter. */
interface StableDiffusionImageGenerationRequest {
  readonly batch_count: number;
  readonly height: number;
  readonly negative_prompt: string;
  readonly output_format: OutputFormatValue;
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
  readonly kind: StableDiffusionJobKindValue;
  readonly poll_url: string;
  readonly status: typeof StableDiffusionJobStatus.queued;
}

/** One native base64 image returned by stable-diffusion.cpp. */
interface StableDiffusionImageResult {
  readonly b64_json: string;
  readonly index: number;
}

/** Native completed image result payload. */
interface StableDiffusionImageResultSet {
  readonly images: readonly StableDiffusionImageResult[];
  readonly output_format: OutputFormatValue;
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
  readonly kind: StableDiffusionJobKindValue;
  readonly queue_position: number;
  readonly result: StableDiffusionImageResultSet | null;
  readonly started: number | null;
  readonly status: StableDiffusionJobStatusValue;
}

/** Supported adapter HTTP method literal union. */
type StableDiffusionHttpMethod =
  | typeof StableDiffusionHttp.methodGet
  | typeof StableDiffusionHttp.methodPost;

/** Native asynchronous job status literal union. */
type StableDiffusionJobStatusValue =
  (typeof StableDiffusionJobStatus)[keyof typeof StableDiffusionJobStatus];

/** Native job kind literal union consumed by this adapter. */
type StableDiffusionJobKindValue =
  (typeof StableDiffusionJobKind)[keyof typeof StableDiffusionJobKind];

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
    kind: Schema.Literal(StableDiffusionJobKind.imageGeneration),
    poll_url: Schema.NonEmptyString,
    status: Schema.Literal(StableDiffusionJobStatus.queued),
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
      OutputFormat.jpeg,
      OutputFormat.png,
      OutputFormat.webp,
    ),
  });

/** Explicit schema for one native structured engine error. */
const StableDiffusionJobErrorSchema: Schema.Schema<StableDiffusionJobError> =
  Schema.Struct({
    code: Schema.NonEmptyString,
    message: Schema.String,
  });

/** Explicit schema for the native asynchronous job payload. */
const StableDiffusionJobSchema: Schema.Schema<StableDiffusionJob> =
  Schema.Struct({
    completed: Schema.NullOr(Schema.Int),
    created: Schema.Int,
    error: Schema.NullOr(StableDiffusionJobErrorSchema),
    id: Schema.NonEmptyString,
    kind: Schema.Literal(StableDiffusionJobKind.imageGeneration),
    queue_position: Schema.NonNegativeInt,
    result: Schema.NullOr(StableDiffusionImageResultSetSchema),
    started: Schema.NullOr(Schema.Int),
    status: Schema.Literal(
      StableDiffusionJobStatus.cancelled,
      StableDiffusionJobStatus.completed,
      StableDiffusionJobStatus.failed,
      StableDiffusionJobStatus.generating,
      StableDiffusionJobStatus.queued,
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
  StableDiffusionJobKindValue,
  StableDiffusionJobStatusValue,
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
