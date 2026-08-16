import { LifecycleState } from "@app/core/lifecycle/lifecycle.constants";

/** Scheduler-visible engine health states. */
const EngineHealth = {
  degraded: "degraded",
  healthy: "healthy",
  offline: "offline",
} as const;

/** Provider-neutral asynchronous engine job states. */
const EngineJobStatus = {
  cancelled: LifecycleState.cancelled,
  failed: LifecycleState.failed,
  queued: LifecycleState.queued,
  running: LifecycleState.running,
  succeeded: LifecycleState.succeeded,
} as const;

/** Numeric engine constants kept out of orchestration code. */
const EngineNumeric = {
  defaultSeed: -1,
  zeroRunning: 0,
} as const;

/** Operator-facing engine routing messages. */
const EngineMessage = {
  noAdapter: "no engine adapter registered for provider",
} as const;

export { EngineHealth, EngineJobStatus, EngineMessage, EngineNumeric };
