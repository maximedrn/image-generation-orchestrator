import type {
  ModelConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import {
  InvalidRequestError,
  LimitExceededError,
} from "@app/core/errors/error.types";
import { JobLimitName, JobMessage } from "@app/modules/jobs/job.constants";
import type { JobCreateRequest } from "@app/modules/jobs/job.types";
import { computeJobCost } from "@app/modules/jobs/job.utils";
import { Effect, Option } from "effect";

/**
 * Computes encoded JSON size without depending on Node.js Buffer semantics.
 *
 * @param {JobCreateRequest} request - Decoded request.
 * @returns {number} UTF-8 byte length of the normalized JSON request.
 */
const requestSizeBytes = (request: JobCreateRequest): number =>
  new TextEncoder().encode(JSON.stringify(request)).byteLength;

/**
 * Validates that the model exists and is assigned to an engine.
 *
 * @param {JobCreateRequest} request - Schema-valid request.
 * @param {PlatformConfig} config - Runtime model registry.
 * @returns {Effect.Effect<void, InvalidRequestError>} Model validation effect.
 */
const validateModel = (
  request: JobCreateRequest,
  config: PlatformConfig,
): Effect.Effect<void, InvalidRequestError> => {
  if (Option.isNone(Option.fromNullable(config.models[request.model]))) {
    return Effect.fail(
      new InvalidRequestError({
        message: `${JobMessage.unknownModel}: ${request.model}`,
      }),
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
          message: `${JobMessage.modelNotAssigned}: ${request.model}`,
        }),
      );
};

/**
 * Validates model-specific and global dimensions.
 *
 * @param {JobCreateRequest} request - Schema-valid request.
 * @param {PlatformConfig} config - Runtime limits.
 * @returns {Effect.Effect<void, LimitExceededError>} Dimension validation effect.
 */
const validateDimensions = (
  request: JobCreateRequest,
  config: PlatformConfig,
): Effect.Effect<void, LimitExceededError> => {
  const modelOption: Option.Option<ModelConfig> = Option.fromNullable(
    config.models[request.model],
  );
  if (Option.isNone(modelOption)) return Effect.void;
  const maxWidth: number = Math.min(
    config.limits.maxWidth,
    modelOption.value.maxWidth,
  );
  const maxHeight: number = Math.min(
    config.limits.maxHeight,
    modelOption.value.maxHeight,
  );
  return request.width <= maxWidth && request.height <= maxHeight
    ? Effect.void
    : Effect.fail(
        new LimitExceededError({
          limit: JobLimitName.dimensions,
          message: `${JobMessage.dimensionsExceeded} ${maxWidth}x${maxHeight}`,
        }),
      );
};

/**
 * Validates all scalar generation guardrails.
 *
 * @param {JobCreateRequest} request - Schema-valid request.
 * @param {PlatformConfig} config - Runtime limits.
 * @returns {Effect.Effect<void, LimitExceededError>} Scalar validation effect.
 */
const validateScalarLimits = (
  request: JobCreateRequest,
  config: PlatformConfig,
): Effect.Effect<void, LimitExceededError> => {
  const pixels: number = request.width * request.height;
  if (pixels > config.limits.maxPixels) {
    return Effect.fail(
      new LimitExceededError({
        limit: JobLimitName.pixels,
        message: JobMessage.pixelsExceeded,
      }),
    );
  }
  if (request.steps > config.limits.maxSteps) {
    return Effect.fail(
      new LimitExceededError({
        limit: JobLimitName.steps,
        message: JobMessage.stepsExceeded,
      }),
    );
  }
  if (request.count > config.limits.maxBatch) {
    return Effect.fail(
      new LimitExceededError({
        limit: JobLimitName.batch,
        message: JobMessage.batchExceeded,
      }),
    );
  }
  return Effect.void;
};

/**
 * Validates serialized-input and estimated-compute guardrails.
 *
 * @param {JobCreateRequest} request - Schema-valid request.
 * @param {PlatformConfig} config - Runtime limits.
 * @returns {Effect.Effect<void, LimitExceededError>} Cost validation effect.
 */
const validateCostLimits = (
  request: JobCreateRequest,
  config: PlatformConfig,
): Effect.Effect<void, LimitExceededError> => {
  if (requestSizeBytes(request) > config.limits.maxInputBytes) {
    return Effect.fail(
      new LimitExceededError({
        limit: JobLimitName.inputBytes,
        message: JobMessage.inputBytesExceeded,
      }),
    );
  }
  return computeJobCost(request) <= config.limits.maxJobCost
    ? Effect.void
    : Effect.fail(
        new LimitExceededError({
          limit: JobLimitName.cost,
          message: JobMessage.costExceeded,
        }),
      );
};

/**
 * Validates deployment-specific limits after schema decoding.
 *
 * @param {JobCreateRequest} request - Schema-valid request.
 * @param {PlatformConfig} config - Runtime limits and model registry.
 * @returns {Effect.Effect<void, InvalidRequestError | LimitExceededError>} Validation effect.
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
