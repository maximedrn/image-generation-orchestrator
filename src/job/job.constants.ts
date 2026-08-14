/** Job statuses persisted by the platform. */
const JOB_STATUS = {
  CANCELLED: "cancelled",
  FAILED: "failed",
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
} as const;

/** Supported image output formats. */
const OUTPUT_FORMAT = {
  JPEG: "jpeg",
  PNG: "png",
  WEBP: "webp",
} as const;

/** Conservative public schema boundaries independent of deployment limits. */
const JOB_SCHEMA_LIMITS = {
  CFG_SCALE_MAX: 64,
  CFG_SCALE_MIN: 0,
  COUNT_MAX: 128,
  COUNT_MIN: 1,
  DIMENSION_MAX: 8192,
  DIMENSION_MIN: 64,
  STEPS_MAX: 10_000,
  STEPS_MIN: 1,
} as const;

/** Stable durable error codes written by queue recovery. */
const JOB_ERROR_CODE = {
  LEASE_EXPIRED: "LEASE_EXPIRED",
} as const;

/** Stable durable error messages written by queue recovery. */
const JOB_ERROR_MESSAGE = {
  LEASE_EXPIRED_MAX_ATTEMPTS: "job lease expired after maximum attempts",
} as const;


/** Stable configuration limit identifiers exposed in typed validation errors. */
const JOB_LIMIT_NAME = {
  BATCH: "maxBatch",
  COST: "maxJobCost",
  DIMENSIONS: "dimensions",
  INPUT_BYTES: "maxInputBytes",
  PIXELS: "maxPixels",
  STEPS: "maxSteps",
} as const;


/** Stable caller-facing job failure code. */
const JOB_PUBLIC_ERROR_CODE = {
  GENERATION_FAILED: "GENERATION_FAILED",
} as const;

/** Safe caller-facing job failure messages. */
const JOB_PUBLIC_ERROR_MESSAGE = {
  GENERATION_FAILED: "image generation failed",
} as const;

/** Public result-route prefix used to generate stable result URLs. */
const JOB_RESULT_ROUTE_PREFIX = "/v1/jobs";

/** Result media type mapping used by local storage. */
const OUTPUT_MIME_TYPE = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

/** Result file extension mapping used by local storage. */
const OUTPUT_EXTENSION = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
} as const;

export {
  JOB_ERROR_CODE,
  JOB_ERROR_MESSAGE,
  JOB_LIMIT_NAME,
  JOB_PUBLIC_ERROR_CODE,
  JOB_PUBLIC_ERROR_MESSAGE,
  JOB_RESULT_ROUTE_PREFIX,
  JOB_SCHEMA_LIMITS,
  JOB_STATUS,
  OUTPUT_EXTENSION,
  OUTPUT_FORMAT,
  OUTPUT_MIME_TYPE,
};
