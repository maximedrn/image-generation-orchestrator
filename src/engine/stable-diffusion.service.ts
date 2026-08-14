import { Effect } from "effect";

import type { EngineConfig } from "@app/config/config.types.js";
import type {
  EngineGatewayError,
  EngineGatewayShape,
} from "@app/engine/engine.interface.js";
import type {
  EngineCapabilities,
  EngineJob,
  EngineSubmission,
} from "@app/engine/engine.types.js";
import {
  STABLE_DIFFUSION_ENDPOINT,
  STABLE_DIFFUSION_HTTP,
  STABLE_DIFFUSION_JOB_ACTION,
} from "@app/engine/stable-diffusion.constants.js";
import { requestDecodedStableDiffusion } from "@app/engine/stable-diffusion.helpers.js";
import type {
  StableDiffusionCapabilities,
  StableDiffusionImageGenerationRequest,
  StableDiffusionJob,
  StableDiffusionJobSubmission,
} from "@app/engine/stable-diffusion.types.js";
import {
  StableDiffusionCapabilitiesSchema,
  StableDiffusionJobSchema,
  StableDiffusionJobSubmissionSchema,
} from "@app/engine/stable-diffusion.types.js";
import {
  toEngineCapabilities,
  toEngineJob,
  toStableDiffusionImageGenerationRequest,
} from "@app/engine/stable-diffusion.utils.js";
import type { JobCreateRequest } from "@app/job/job.types.js";

/**
 * Builds an encoded native job path safe for URL interpolation.
 *
 * @param remoteJobId - (string) Native job identifier.
 * @param action - (string | undefined) Optional native job action segment.
 * @returns (string) Encoded native API job path.
 */
const stableDiffusionJobPath = (
  remoteJobId: string,
  action?: string,
): string => {
  const encodedRemoteJobId: string = encodeURIComponent(remoteJobId);
  const basePath: string = `${STABLE_DIFFUSION_ENDPOINT.JOBS}/${encodedRemoteJobId}`;
  return action === undefined ? basePath : `${basePath}/${action}`;
};

/**
 * Cancels one native stable-diffusion.cpp asynchronous job.
 *
 * @param engine - (EngineConfig) Target engine.
 * @param remoteJobId - (string) Native job identifier.
 * @returns (Effect.Effect<EngineJob, EngineGatewayError>) Provider-neutral job.
 */
const cancelStableDiffusionJob = (
  engine: EngineConfig,
  remoteJobId: string,
): Effect.Effect<EngineJob, EngineGatewayError> =>
  requestDecodedStableDiffusion<StableDiffusionJob>(
    engine,
    stableDiffusionJobPath(remoteJobId, STABLE_DIFFUSION_JOB_ACTION.CANCEL),
    STABLE_DIFFUSION_HTTP.METHOD_POST,
    STABLE_DIFFUSION_HTTP.OK,
    StableDiffusionJobSchema,
    undefined,
  ).pipe(Effect.map((job: StableDiffusionJob): EngineJob => toEngineJob(job)));

/**
 * Reads native stable-diffusion.cpp capabilities.
 *
 * @param engine - (EngineConfig) Target engine.
 * @returns (Effect.Effect<EngineCapabilities, EngineGatewayError>) Capabilities.
 */
const getStableDiffusionCapabilities = (
  engine: EngineConfig,
): Effect.Effect<EngineCapabilities, EngineGatewayError> =>
  requestDecodedStableDiffusion<StableDiffusionCapabilities>(
    engine,
    STABLE_DIFFUSION_ENDPOINT.CAPABILITIES,
    STABLE_DIFFUSION_HTTP.METHOD_GET,
    STABLE_DIFFUSION_HTTP.OK,
    StableDiffusionCapabilitiesSchema,
    undefined,
  ).pipe(
    Effect.map(
      (capabilities: StableDiffusionCapabilities): EngineCapabilities =>
        toEngineCapabilities(capabilities),
    ),
  );

/**
 * Polls one native stable-diffusion.cpp asynchronous job.
 *
 * @param engine - (EngineConfig) Target engine.
 * @param remoteJobId - (string) Native job identifier.
 * @returns (Effect.Effect<EngineJob, EngineGatewayError>) Provider-neutral job.
 */
const pollStableDiffusionJob = (
  engine: EngineConfig,
  remoteJobId: string,
): Effect.Effect<EngineJob, EngineGatewayError> =>
  requestDecodedStableDiffusion<StableDiffusionJob>(
    engine,
    stableDiffusionJobPath(remoteJobId),
    STABLE_DIFFUSION_HTTP.METHOD_GET,
    STABLE_DIFFUSION_HTTP.OK,
    StableDiffusionJobSchema,
    undefined,
  ).pipe(Effect.map((job: StableDiffusionJob): EngineJob => toEngineJob(job)));

/**
 * Submits one image-generation request to stable-diffusion.cpp.
 *
 * @param engine - (EngineConfig) Target engine.
 * @param request - (JobCreateRequest) Provider-neutral request.
 * @returns (Effect.Effect<EngineSubmission, EngineGatewayError>) Submission id.
 */
const submitStableDiffusionJob = (
  engine: EngineConfig,
  request: JobCreateRequest,
): Effect.Effect<EngineSubmission, EngineGatewayError> => {
  const nativeRequest: StableDiffusionImageGenerationRequest =
    toStableDiffusionImageGenerationRequest(request);
  return requestDecodedStableDiffusion<StableDiffusionJobSubmission>(
    engine,
    STABLE_DIFFUSION_ENDPOINT.IMAGE_GENERATION,
    STABLE_DIFFUSION_HTTP.METHOD_POST,
    STABLE_DIFFUSION_HTTP.ACCEPTED,
    StableDiffusionJobSubmissionSchema,
    nativeRequest,
  ).pipe(
    Effect.map(
      (submission: StableDiffusionJobSubmission): EngineSubmission => ({
        id: submission.id,
      }),
    ),
  );
};

/**
 * Builds the stable-diffusion.cpp implementation of the provider-neutral port.
 *
 * @returns (EngineGatewayShape) Concrete stable-diffusion.cpp adapter.
 */
const createStableDiffusionGateway = (): EngineGatewayShape => ({
  cancel: cancelStableDiffusionJob,
  capabilities: getStableDiffusionCapabilities,
  poll: pollStableDiffusionJob,
  submit: submitStableDiffusionJob,
});

export {
  cancelStableDiffusionJob,
  createStableDiffusionGateway,
  getStableDiffusionCapabilities,
  pollStableDiffusionJob,
  stableDiffusionJobPath,
  submitStableDiffusionJob,
};
