import { Effect } from "effect";

import type { ModelConfig, PlatformConfig } from "@app/config/config.types.js";
import {
  InvalidRequestError,
  LimitExceededError,
} from "@app/error/error.types.js";
import { JOB_LIMIT_NAME } from "@app/job/job.constants.js";
import type { JobCreateRequest } from "@app/job/job.types.js";
import { computeJobCost } from "@app/job/job.utils.js";

/**
 * Computes encoded JSON size without depending on Node.js Buffer semantics.
 *
 * @param request - (JobCreateRequest) Decoded request.
 * @returns (number) UTF-8 byte length of the normalized JSON request.
 */
const requestSizeBytes = (request: JobCreateRequest): number =>
  new TextEncoder().encode(JSON.stringify(request)).byteLength;

/**
 * Validates that the model exists and is assigned to an engine.
 *
 * @param request - (JobCreateRequest) Schema-valid request.
 * @param config - (PlatformConfig) Runtime model registry.
 * @returns (Effect.Effect<void, InvalidRequestError>) Model validation effect.
 */
const validateModel = (
  request: JobCreateRequest,
  config: PlatformConfig,
): Effect.Effect<void, InvalidRequestError> => {
  if (config.models[request.model] === undefined) {
    return Effect.fail(
      new InvalidRequestError({ message: `unknown model: ${request.model}` }),
    );
  }
  const assigned: boolean = config.engines.some(
    (engine: PlatformConfig["engines"][number]): boolean =>
      engine.models.includes(request.model),
  );
  return assigned
    ? Effect.void
    : Effect.fail(
        new InvalidRequestError({
          message: `model ${request.model} is not assigned to any engine`,
        }),
      );
};

/**
 * Validates model-specific and global dimensions.
 *
 * @param request - (JobCreateRequest) Schema-valid request.
 * @param config - (PlatformConfig) Runtime limits.
 * @returns (Effect.Effect<void, LimitExceededError>) Dimension validation effect.
 */
const validateDimensions = (
  request: JobCreateRequest,
  config: PlatformConfig,
): Effect.Effect<void, LimitExceededError> => {
  const modelConfig: ModelConfig | undefined = config.models[request.model];
  if (modelConfig === undefined) return Effect.void;
  const maxWidth: number = Math.min(config.limits.maxWidth, modelConfig.maxWidth);
  const maxHeight: number = Math.min(
    config.limits.maxHeight,
    modelConfig.maxHeight,
  );
  return request.width <= maxWidth && request.height <= maxHeight
    ? Effect.void
    : Effect.fail(
        new LimitExceededError({
          limit: JOB_LIMIT_NAME.DIMENSIONS,
          message: `requested dimensions exceed ${maxWidth}x${maxHeight}`,
        }),
      );
};

/**
 * Validates all scalar generation guardrails.
 *
 * @param request - (JobCreateRequest) Schema-valid request.
 * @param config - (PlatformConfig) Runtime limits.
 * @returns (Effect.Effect<void, LimitExceededError>) Scalar validation effect.
 */
const validateScalarLimits = (
  request: JobCreateRequest,
  config: PlatformConfig,
): Effect.Effect<void, LimitExceededError> => {
  const pixels: number = request.width * request.height;
  if (pixels > config.limits.maxPixels) {
    return Effect.fail(
      new LimitExceededError({
        limit: JOB_LIMIT_NAME.PIXELS,
        message: "requested pixel count exceeds the configured limit",
      }),
    );
  }
  if (request.steps > config.limits.maxSteps) {
    return Effect.fail(
      new LimitExceededError({
        limit: JOB_LIMIT_NAME.STEPS,
        message: "requested sampling steps exceed the configured limit",
      }),
    );
  }
  if (request.count > config.limits.maxBatch) {
    return Effect.fail(
      new LimitExceededError({
        limit: JOB_LIMIT_NAME.BATCH,
        message: "requested image count exceeds the configured limit",
      }),
    );
  }
  return Effect.void;
};

/**
 * Validates serialized-input and estimated-compute guardrails.
 *
 * @param request - (JobCreateRequest) Schema-valid request.
 * @param config - (PlatformConfig) Runtime limits.
 * @returns (Effect.Effect<void, LimitExceededError>) Cost validation effect.
 */
const validateCostLimits = (
  request: JobCreateRequest,
  config: PlatformConfig,
): Effect.Effect<void, LimitExceededError> => {
  if (requestSizeBytes(request) > config.limits.maxInputBytes) {
    return Effect.fail(
      new LimitExceededError({
        limit: JOB_LIMIT_NAME.INPUT_BYTES,
        message: "normalized request exceeds the configured input limit",
      }),
    );
  }
  return computeJobCost(request) <= config.limits.maxJobCost
    ? Effect.void
    : Effect.fail(
        new LimitExceededError({
          limit: JOB_LIMIT_NAME.COST,
          message: "requested generation cost exceeds the configured limit",
        }),
      );
};

/**
 * Validates deployment-specific limits after schema decoding.
 *
 * @param request - (JobCreateRequest) Schema-valid request.
 * @param config - (PlatformConfig) Runtime limits and model registry.
 * @returns (Effect.Effect<void, InvalidRequestError | LimitExceededError>) Validation effect.
 */
const validateJobLimits = (
  request: JobCreateRequest,
  config: PlatformConfig,
): Effect.Effect<void, InvalidRequestError | LimitExceededError> =>
  validateModel(request, config).pipe(
    Effect.zipRight(validateDimensions(request, config)),
    Effect.zipRight(validateScalarLimits(request, config)),
    Effect.zipRight(validateCostLimits(request, config)),
  );

export {
  requestSizeBytes,
  validateCostLimits,
  validateDimensions,
  validateJobLimits,
  validateModel,
  validateScalarLimits,
};
