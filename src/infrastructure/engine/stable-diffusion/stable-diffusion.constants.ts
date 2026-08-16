import { LifecycleState } from "@app/core/lifecycle/lifecycle.constants";

/** stable-diffusion.cpp native API paths. */
const StableDiffusionEndpoint = {
  capabilities: "/sdcpp/v1/capabilities",
  imageGeneration: "/sdcpp/v1/img_gen",
  jobs: "/sdcpp/v1/jobs",
} as const;

/** stable-diffusion.cpp native job sub-path segments. */
const StableDiffusionJobAction = {
  cancel: "cancel",
} as const;

/** stable-diffusion.cpp native asynchronous job kind consumed by the adapter. */
const StableDiffusionJobKind = {
  imageGeneration: "img_gen",
} as const;

/** stable-diffusion.cpp native asynchronous job states. */
const StableDiffusionJobStatus = {
  cancelled: LifecycleState.cancelled,
  completed: LifecycleState.completed,
  failed: LifecycleState.failed,
  generating: LifecycleState.generating,
  queued: LifecycleState.queued,
} as const;

/** HTTP constants isolated inside the stable-diffusion.cpp adapter. */
const StableDiffusionHttp = {
  accepted: 202,
  contentTypeJson: "application/json",
  headerContentType: "content-type",
  methodGet: "GET",
  methodPost: "POST",
  ok: 200,
} as const;

/** Operator-facing messages emitted by the stable-diffusion.cpp adapter. */
const StableDiffusionMessage = {
  rejected: "engine rejected request with HTTP",
  requestFailed: "engine request failed",
  schemaViolation: "engine response violates the expected schema",
} as const;

export {
  StableDiffusionEndpoint,
  StableDiffusionHttp,
  StableDiffusionJobAction,
  StableDiffusionJobKind,
  StableDiffusionJobStatus,
  StableDiffusionMessage,
};
