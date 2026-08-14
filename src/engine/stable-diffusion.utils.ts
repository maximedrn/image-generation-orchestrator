import { ENGINE_JOB_STATUS, ENGINE_NUMERIC } from "@app/engine/engine.constants.js";
import type {
  EngineCapabilities,
  EngineImageResult,
  EngineImageResultSet,
  EngineJob,
  EngineJobStatus,
} from "@app/engine/engine.types.js";
import {
  STABLE_DIFFUSION_JOB_KIND,
  STABLE_DIFFUSION_JOB_STATUS,
} from "@app/engine/stable-diffusion.constants.js";
import type {
  StableDiffusionCapabilities,
  StableDiffusionImageGenerationRequest,
  StableDiffusionImageResult,
  StableDiffusionImageResultSet,
  StableDiffusionJob,
  StableDiffusionJobStatus,
} from "@app/engine/stable-diffusion.types.js";
import { OUTPUT_FORMAT } from "@app/job/job.constants.js";
import type { JobCreateRequest, OutputFormat } from "@app/job/job.types.js";

/**
 * Converts the public platform request to the native stable-diffusion.cpp contract.
 *
 * @param request - (JobCreateRequest) Fully validated platform request.
 * @returns (StableDiffusionImageGenerationRequest) Native asynchronous request.
 */
const toStableDiffusionImageGenerationRequest = (
  request: JobCreateRequest,
): StableDiffusionImageGenerationRequest => ({
  batch_count: request.count,
  height: request.height,
  negative_prompt: request.negativePrompt ?? "",
  output_format: request.outputFormat ?? OUTPUT_FORMAT.PNG,
  prompt: request.prompt,
  sample_params: {
    guidance: { txt_cfg: request.cfgScale },
    sample_steps: request.steps,
  },
  seed: request.seed ?? ENGINE_NUMERIC.DEFAULT_SEED,
  width: request.width,
});

/**
 * Maps native engine capabilities to the provider-neutral port contract.
 *
 * @param capabilities - (StableDiffusionCapabilities) Decoded native payload.
 * @returns (EngineCapabilities) Provider-neutral capabilities.
 */
const toEngineCapabilities = (
  capabilities: StableDiffusionCapabilities,
): EngineCapabilities => {
  const supportedFormats: ReadonlySet<string> = new Set<string>([
    OUTPUT_FORMAT.JPEG,
    OUTPUT_FORMAT.PNG,
    OUTPUT_FORMAT.WEBP,
  ]);
  const nativeOutputFormats: readonly string[] =
    capabilities.output_formats_by_mode[
      STABLE_DIFFUSION_JOB_KIND.IMAGE_GENERATION
    ] ?? [];
  const outputFormats: readonly OutputFormat[] = nativeOutputFormats.filter(
    (format: string): format is OutputFormat => supportedFormats.has(format),
  );
  return {
    outputFormats,
    supportsImageGeneration: capabilities.supported_modes.includes(
      STABLE_DIFFUSION_JOB_KIND.IMAGE_GENERATION,
    ),
  };
};

/**
 * Maps one native asynchronous status to the provider-neutral state machine.
 *
 * @param status - (StableDiffusionJobStatus) Decoded native status.
 * @returns (EngineJobStatus) Provider-neutral engine status.
 */
const toEngineJobStatus = (
  status: StableDiffusionJobStatus,
): EngineJobStatus => {
  switch (status) {
    case STABLE_DIFFUSION_JOB_STATUS.CANCELLED:
      return ENGINE_JOB_STATUS.CANCELLED;
    case STABLE_DIFFUSION_JOB_STATUS.COMPLETED:
      return ENGINE_JOB_STATUS.SUCCEEDED;
    case STABLE_DIFFUSION_JOB_STATUS.FAILED:
      return ENGINE_JOB_STATUS.FAILED;
    case STABLE_DIFFUSION_JOB_STATUS.GENERATING:
      return ENGINE_JOB_STATUS.RUNNING;
    case STABLE_DIFFUSION_JOB_STATUS.QUEUED:
      return ENGINE_JOB_STATUS.QUEUED;
  }
};

/**
 * Maps one native image result to the provider-neutral representation.
 *
 * @param image - (StableDiffusionImageResult) Decoded native image.
 * @returns (EngineImageResult) Provider-neutral image result.
 */
const toEngineImageResult = (
  image: StableDiffusionImageResult,
): EngineImageResult => ({ base64: image.b64_json, index: image.index });

/**
 * Maps a nullable native image result set to the provider-neutral representation.
 *
 * @param result - (StableDiffusionImageResultSet | null) Native result set.
 * @returns (EngineImageResultSet | null) Provider-neutral result set.
 */
const toEngineImageResultSet = (
  result: StableDiffusionImageResultSet | null,
): EngineImageResultSet | null =>
  result === null
    ? null
    : {
        images: result.images.map(
          (image: StableDiffusionImageResult): EngineImageResult =>
            toEngineImageResult(image),
        ),
        outputFormat: result.output_format,
      };

/**
 * Maps one decoded stable-diffusion.cpp job to the provider-neutral engine port.
 *
 * @param job - (StableDiffusionJob) Decoded native job.
 * @returns (EngineJob) Provider-neutral engine job.
 */
const toEngineJob = (job: StableDiffusionJob): EngineJob => ({
  error: job.error,
  id: job.id,
  result: toEngineImageResultSet(job.result),
  status: toEngineJobStatus(job.status),
});

export {
  toEngineCapabilities,
  toEngineImageResult,
  toEngineImageResultSet,
  toEngineJob,
  toEngineJobStatus,
  toStableDiffusionImageGenerationRequest,
};
