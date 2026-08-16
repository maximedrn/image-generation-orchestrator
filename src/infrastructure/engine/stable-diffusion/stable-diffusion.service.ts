import type { EngineConfig } from "@app/core/config/config.types";
import type {
  EngineGatewayError,
  EngineGatewayShape,
} from "@app/infrastructure/engine/engine.interface";
import type {
  EngineCapabilities,
  EngineJob,
  EngineSubmission,
} from "@app/infrastructure/engine/engine.types";
import {
  StableDiffusionEndpoint,
  StableDiffusionHttp,
  StableDiffusionJobAction,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.constants";
import { requestDecodedStableDiffusion } from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.helpers";
import type {
  StableDiffusionCapabilities,
  StableDiffusionImageGenerationRequest,
  StableDiffusionJob,
  StableDiffusionJobSubmission,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.types";
import {
  StableDiffusionCapabilitiesSchema,
  StableDiffusionJobSchema,
  StableDiffusionJobSubmissionSchema,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.types";
import {
  toEngineCapabilities,
  toEngineJob,
  toStableDiffusionImageGenerationRequest,
} from "@app/infrastructure/engine/stable-diffusion/stable-diffusion.utils";
import type { JobCreateRequest } from "@app/modules/jobs/job.types";
import type { HttpClient } from "@effect/platform";
import { Effect, Option } from "effect";

/**
 * Builds an encoded native job path safe for URL interpolation.
 *
 * @param {string} remoteJobId - Native job identifier.
 * @param {string | undefined} action - Optional native job action segment.
 * @returns {string} Encoded native API job path.
 */
const stableDiffusionJobPath = (
  remoteJobId: string,
  action?: string,
): string => {
  const encodedRemoteJobId: string = encodeURIComponent(remoteJobId);
  const basePath: string = `${StableDiffusionEndpoint.jobs}/${encodedRemoteJobId}`;
  return Option.match(Option.fromNullable(action), {
    onNone: (): string => basePath,
    onSome: (segment: string): string => `${basePath}/${segment}`,
  });
};

/**
 * Cancels one native stable-diffusion.cpp asynchronous job.
 *
 * @param {HttpClient.HttpClient} client - Effect HTTP client.
 * @param {EngineConfig} engine - Target engine.
 * @param {string} remoteJobId - Native job identifier.
 * @returns {Effect.Effect<EngineJob, EngineGatewayError>} Provider-neutral job.
 */
const cancelStableDiffusionJob = (
  client: HttpClient.HttpClient,
  engine: EngineConfig,
  remoteJobId: string,
): Effect.Effect<EngineJob, EngineGatewayError> =>
  requestDecodedStableDiffusion<StableDiffusionJob>(client, engine, {
    body: undefined,
    expectedStatus: StableDiffusionHttp.ok,
    method: StableDiffusionHttp.methodPost,
    path: stableDiffusionJobPath(remoteJobId, StableDiffusionJobAction.cancel),
    schema: StableDiffusionJobSchema,
  }).pipe(Effect.map((job: StableDiffusionJob): EngineJob => toEngineJob(job)));

/**
 * Reads native stable-diffusion.cpp capabilities.
 *
 * @param {HttpClient.HttpClient} client - Effect HTTP client.
 * @param {EngineConfig} engine - Target engine.
 * @returns {Effect.Effect<EngineCapabilities, EngineGatewayError>} Capabilities.
 */
const getStableDiffusionCapabilities = (
  client: HttpClient.HttpClient,
  engine: EngineConfig,
): Effect.Effect<EngineCapabilities, EngineGatewayError> =>
  requestDecodedStableDiffusion<StableDiffusionCapabilities>(client, engine, {
    body: undefined,
    expectedStatus: StableDiffusionHttp.ok,
    method: StableDiffusionHttp.methodGet,
    path: StableDiffusionEndpoint.capabilities,
    schema: StableDiffusionCapabilitiesSchema,
  }).pipe(
    Effect.map(
      (capabilities: StableDiffusionCapabilities): EngineCapabilities =>
        toEngineCapabilities(capabilities),
    ),
  );

/**
 * Polls one native stable-diffusion.cpp asynchronous job.
 *
 * @param {HttpClient.HttpClient} client - Effect HTTP client.
 * @param {EngineConfig} engine - Target engine.
 * @param {string} remoteJobId - Native job identifier.
 * @returns {Effect.Effect<EngineJob, EngineGatewayError>} Provider-neutral job.
 */
const pollStableDiffusionJob = (
  client: HttpClient.HttpClient,
  engine: EngineConfig,
  remoteJobId: string,
): Effect.Effect<EngineJob, EngineGatewayError> =>
  requestDecodedStableDiffusion<StableDiffusionJob>(client, engine, {
    body: undefined,
    expectedStatus: StableDiffusionHttp.ok,
    method: StableDiffusionHttp.methodGet,
    path: stableDiffusionJobPath(remoteJobId),
    schema: StableDiffusionJobSchema,
  }).pipe(Effect.map((job: StableDiffusionJob): EngineJob => toEngineJob(job)));

/**
 * Submits one image-generation request to stable-diffusion.cpp.
 *
 * @param {HttpClient.HttpClient} client - Effect HTTP client.
 * @param {EngineConfig} engine - Target engine.
 * @param {JobCreateRequest} request - Provider-neutral request.
 * @returns {Effect.Effect<EngineSubmission, EngineGatewayError>} Submission id.
 */
const submitStableDiffusionJob = (
  client: HttpClient.HttpClient,
  engine: EngineConfig,
  request: JobCreateRequest,
): Effect.Effect<EngineSubmission, EngineGatewayError> => {
  const nativeRequest: StableDiffusionImageGenerationRequest =
    toStableDiffusionImageGenerationRequest(request);
  return requestDecodedStableDiffusion<StableDiffusionJobSubmission>(
    client,
    engine,
    {
      body: nativeRequest,
      expectedStatus: StableDiffusionHttp.accepted,
      method: StableDiffusionHttp.methodPost,
      path: StableDiffusionEndpoint.imageGeneration,
      schema: StableDiffusionJobSubmissionSchema,
    },
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
 * @param {HttpClient.HttpClient} client - Effect HTTP client.
 * @returns {EngineGatewayShape} Concrete stable-diffusion.cpp adapter.
 */
const createStableDiffusionGateway = (
  client: HttpClient.HttpClient,
): EngineGatewayShape => ({
  cancel: cancelStableDiffusionJob.bind(undefined, client),
  capabilities: getStableDiffusionCapabilities.bind(undefined, client),
  poll: pollStableDiffusionJob.bind(undefined, client),
  submit: submitStableDiffusionJob.bind(undefined, client),
});

export {
  cancelStableDiffusionJob,
  createStableDiffusionGateway,
  getStableDiffusionCapabilities,
  pollStableDiffusionJob,
  stableDiffusionJobPath,
  submitStableDiffusionJob,
};
