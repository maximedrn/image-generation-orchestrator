import { LifecycleState } from "@app/core/lifecycle/lifecycle.constants";

/** Job statuses persisted by the platform. */
const JobStatus = {
  cancelled: LifecycleState.cancelled,
  failed: LifecycleState.failed,
  queued: LifecycleState.queued,
  running: LifecycleState.running,
  succeeded: LifecycleState.succeeded,
} as const;

/** Supported image output formats. */
const OutputFormat = {
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
} as const;

/** Conservative public schema boundaries independent of deployment limits. */
const JobSchemaLimits = {
  cfgScaleMax: 64,
  cfgScaleMin: 0,
  countMax: 128,
  countMin: 1,
  dimensionMax: 8192,
  dimensionMin: 64,
  stepsMax: 10_000,
  stepsMin: 1,
} as const;

/** Stable durable error codes written by queue recovery. */
const JobErrorCode = {
  leaseExpired: "LEASE_EXPIRED",
} as const;

/** Stable durable error messages written by queue recovery. */
const JobErrorMessage = {
  leaseExpiredMaxAttempts: "job lease expired after maximum attempts",
} as const;

/** Stable configuration limit identifiers exposed in typed validation errors. */
const JobLimitName = {
  batch: "maxBatch",
  cost: "maxJobCost",
  dimensions: "dimensions",
  inputBytes: "maxInputBytes",
  pixels: "maxPixels",
  steps: "maxSteps",
} as const;

/** Stable caller-facing job failure code. */
const JobPublicErrorCode = {
  generationFailed: "GENERATION_FAILED",
} as const;

/** Safe caller-facing job messages. */
const JobMessage = {
  alreadyTerminal: "job is already terminal",
  batchExceeded: "requested image count exceeds the configured limit",
  costExceeded: "requested generation cost exceeds the configured limit",
  dimensionsExceeded: "requested dimensions exceed",
  generationFailed: "image generation failed",
  inputBytesExceeded: "normalized request exceeds the configured input limit",
  invalidRequest: "invalid generation request",
  modelNotAssigned: "model is not assigned to any engine",
  pixelsExceeded: "requested pixel count exceeds the configured limit",
  queueFull: "generation queue is full",
  stepsExceeded: "requested sampling steps exceed the configured limit",
  unknownModel: "unknown model",
} as const;

/** Admission-control bounds shared by the queue and the rate limiter. */
const JobAdmission = {
  minimumRetryAfterSeconds: 1,
} as const;

/** Result media type mapping used by local storage. */
const OutputMimeType = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

/** Result file extension mapping used by local storage. */
const OutputExtension = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
} as const;

export {
  JobAdmission,
  JobErrorCode,
  JobErrorMessage,
  JobLimitName,
  JobMessage,
  JobPublicErrorCode,
  JobSchemaLimits,
  JobStatus,
  OutputExtension,
  OutputFormat,
  OutputMimeType,
};
