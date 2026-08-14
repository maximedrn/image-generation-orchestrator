/** Stable internal failure codes persisted without leaking upstream bodies. */
const DISPATCHER_ERROR_CODE = {
  ENGINE: "ENGINE_ERROR",
  REMOTE: "REMOTE_GENERATION_FAILED",
  STORAGE: "RESULT_STORAGE_FAILED",
} as const;

/** Stable durable messages persisted for platform-owned dispatcher failures. */
const DISPATCHER_ERROR_MESSAGE = {
  ENGINE_RETRY_EXHAUSTED: "inference engine unavailable after retry budget",
  EMPTY_RESULT: "completed engine job did not contain an image result",
  REMOTE_FAILED: "remote generation failed",
  STORAGE_FAILED: "completed output could not be persisted",
} as const;

export { DISPATCHER_ERROR_CODE, DISPATCHER_ERROR_MESSAGE };
