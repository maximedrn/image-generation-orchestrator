/** Scheduler-visible engine health states. */
const ENGINE_HEALTH = {
  DEGRADED: "degraded",
  HEALTHY: "healthy",
  OFFLINE: "offline",
} as const;

/** Provider-neutral asynchronous engine job states. */
const ENGINE_JOB_STATUS = {
  CANCELLED: "cancelled",
  FAILED: "failed",
  QUEUED: "queued",
  RUNNING: "running",
  SUCCEEDED: "succeeded",
} as const;

/** Numeric engine constants kept out of orchestration code. */
const ENGINE_NUMERIC = {
  DEFAULT_SEED: -1,
  ZERO_RUNNING: 0,
} as const;

export { ENGINE_HEALTH, ENGINE_JOB_STATUS, ENGINE_NUMERIC };
