/** stable-diffusion.cpp native API paths. */
const STABLE_DIFFUSION_ENDPOINT = {
  CAPABILITIES: "/sdcpp/v1/capabilities",
  IMAGE_GENERATION: "/sdcpp/v1/img_gen",
  JOBS: "/sdcpp/v1/jobs",
} as const;

/** stable-diffusion.cpp native job sub-path segments. */
const STABLE_DIFFUSION_JOB_ACTION = {
  CANCEL: "cancel",
} as const;

/** stable-diffusion.cpp native asynchronous job kind consumed by the adapter. */
const STABLE_DIFFUSION_JOB_KIND = {
  IMAGE_GENERATION: "img_gen",
} as const;

/** stable-diffusion.cpp native asynchronous job states. */
const STABLE_DIFFUSION_JOB_STATUS = {
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  FAILED: "failed",
  GENERATING: "generating",
  QUEUED: "queued",
} as const;

/** HTTP constants isolated inside the stable-diffusion.cpp adapter. */
const STABLE_DIFFUSION_HTTP = {
  ACCEPTED: 202,
  CONTENT_TYPE_JSON: "application/json",
  HEADER_CONTENT_TYPE: "content-type",
  METHOD_GET: "GET",
  METHOD_POST: "POST",
  OK: 200,
} as const;

export {
  STABLE_DIFFUSION_ENDPOINT,
  STABLE_DIFFUSION_HTTP,
  STABLE_DIFFUSION_JOB_ACTION,
  STABLE_DIFFUSION_JOB_KIND,
  STABLE_DIFFUSION_JOB_STATUS,
};
