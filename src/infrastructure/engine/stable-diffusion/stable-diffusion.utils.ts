import {
  EngineJobStatus,
  EngineNumeric,
} from "@app/infrastructure/engine/engine.constants";
import type {
  EngineCapabilities,
  EngineImageResult,
  EngineImageResultSet,
  EngineJob,
  EngineJobProgress,
  EngineJobStatusValue,
} from "@app/infrastructure/engine/engine.types";
import {
  StableDiffusionJobKind,
  StableDiffusionJobStatus,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.constants";
import type {
  StableDiffusionCapabilities,
  StableDiffusionImageGenerationRequest,
  StableDiffusionImageResult,
  StableDiffusionImageResultSet,
  StableDiffusionJob,
  StableDiffusionJobStatusValue,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.types";
import { OutputFormat } from "@app/modules/jobs/job.constants";
import type {
  JobCreateRequest,
  OutputFormatValue,
} from "@app/modules/jobs/job.types";
import { Option } from "effect";

/**
 * Converts the public platform request to the native stable-diffusion.cpp contract.
 *
 * @param {JobCreateRequest} request - Fully validated platform request.
 * @returns {StableDiffusionImageGenerationRequest} Native asynchronous request.
 */
const toStableDiffusionImageGenerationRequest = (
  request: JobCreateRequest,
): StableDiffusionImageGenerationRequest => ({
  batch_count: request.count,
  height: request.height,
  negative_prompt: request.negativePrompt ?? "",
  output_format: request.outputFormat ?? OutputFormat.png,
  prompt: request.prompt,
  sample_params: {
    guidance: { txt_cfg: request.cfgScale },
    sample_steps: request.steps,
  },
  seed: request.seed ?? EngineNumeric.defaultSeed,
  width: request.width,
});

/**
 * Maps native engine capabilities to the provider-neutral port contract.
 *
 * @param {StableDiffusionCapabilities} capabilities - Decoded native payload.
 * @returns {EngineCapabilities} Provider-neutral capabilities.
 */
const toEngineCapabilities = (
  capabilities: StableDiffusionCapabilities,
): EngineCapabilities => {
  const supportedFormats: ReadonlySet<string> = new Set<string>([
    OutputFormat.jpeg,
    OutputFormat.png,
    OutputFormat.webp,
  ]);
  const nativeOutputFormats: readonly string[] =
    capabilities.output_formats_by_mode[
      StableDiffusionJobKind.imageGeneration
    ] ?? [];
  const outputFormats: readonly OutputFormatValue[] =
    nativeOutputFormats.filter((format: string): format is OutputFormatValue =>
      supportedFormats.has(format),
    );
  return {
    outputFormats,
    supportsImageGeneration: capabilities.supported_modes.includes(
      StableDiffusionJobKind.imageGeneration,
    ),
  };
};

/**
 * Maps one native asynchronous status to the provider-neutral state machine.
 *
 * @param {StableDiffusionJobStatusValue} status - Decoded native status.
 * @returns {EngineJobStatusValue} Provider-neutral engine status.
 */
const toEngineJobStatus = (
  status: StableDiffusionJobStatusValue,
): EngineJobStatusValue => {
  switch (status) {
    case StableDiffusionJobStatus.cancelled:
      return EngineJobStatus.cancelled;
    case StableDiffusionJobStatus.completed:
      return EngineJobStatus.succeeded;
    case StableDiffusionJobStatus.failed:
      return EngineJobStatus.failed;
    case StableDiffusionJobStatus.generating:
      return EngineJobStatus.running;
    default:
      return EngineJobStatus.queued;
  }
};

/**
 * Maps one native image result to the provider-neutral representation.
 *
 * @param {StableDiffusionImageResult} image - Decoded native image.
 * @returns {EngineImageResult} Provider-neutral image result.
 */
const toEngineImageResult = (
  image: StableDiffusionImageResult,
): EngineImageResult => ({ base64: image.b64_json, index: image.index });

/**
 * Maps a nullable native image result set to the provider-neutral representation.
 *
 * @param {StableDiffusionImageResultSet | null} result - Native result set.
 * @returns {EngineImageResultSet | null} Provider-neutral result set.
 */
const toEngineImageResultSet = (
  result: StableDiffusionImageResultSet | null,
): EngineImageResultSet | null =>
  Option.getOrNull(
    Option.map(
      Option.fromNullable(result),
      (present: StableDiffusionImageResultSet): EngineImageResultSet => ({
        images: present.images.map(
          (image: StableDiffusionImageResult): EngineImageResult =>
            toEngineImageResult(image),
        ),
        outputFormat: present.output_format,
      }),
    ),
  );

/**
 * Reads the sampling progress an engine reports, when it reports one.
 *
 * An engine built without the progress patch omits both fields, and one that
 * has not started sampling announces a total of zero. Neither is progress, so
 * both yield an absent value rather than a misleading zero percent.
 *
 * @param {StableDiffusionJob} job - Decoded native job.
 * @returns {{ progress?: EngineJobProgress }} Progress patch, possibly empty.
 */
const toEngineJobProgress = (
  job: StableDiffusionJob,
): { progress?: EngineJobProgress } => {
  const total: number = job.progress_steps ?? 0;
  return total > 0
    ? { progress: { completed: job.progress_step ?? 0, total } }
    : {};
};

/**
 * Maps one decoded stable-diffusion.cpp job to the provider-neutral engine port.
 *
 * @param {StableDiffusionJob} job - Decoded native job.
 * @returns {EngineJob} Provider-neutral engine job.
 */
const toEngineJob = (job: StableDiffusionJob): EngineJob => ({
  error: job.error,
  id: job.id,
  ...toEngineJobProgress(job),
  result: toEngineImageResultSet(job.result),
  status: toEngineJobStatus(job.status),
});

export {
  toEngineCapabilities,
  toEngineImageResult,
  toEngineImageResultSet,
  toEngineJob,
  toEngineJobProgress,
  toEngineJobStatus,
  toStableDiffusionImageGenerationRequest,
};
