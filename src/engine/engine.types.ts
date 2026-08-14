import type { EngineConfig } from "@app/config/config.types.js";
import type { ENGINE_HEALTH, ENGINE_JOB_STATUS } from "@app/engine/engine.constants.js";
import type { OutputFormat } from "@app/job/job.types.js";

/** Provider-neutral engine capability contract used by readiness checks. */
interface EngineCapabilities {
  readonly outputFormats: readonly OutputFormat[];
  readonly supportsImageGeneration: boolean;
}

/** One provider-neutral generated image returned by an inference engine. */
interface EngineImageResult {
  readonly base64: string;
  readonly index: number;
}

/** Provider-neutral completed image generation result. */
interface EngineImageResultSet {
  readonly images: readonly EngineImageResult[];
  readonly outputFormat: OutputFormat;
}

/** Provider-neutral structured inference failure. */
interface EngineJobError {
  readonly code: string;
  readonly message: string;
}

/** Provider-neutral asynchronous inference job representation. */
interface EngineJob {
  readonly error: EngineJobError | null;
  readonly id: string;
  readonly result: EngineImageResultSet | null;
  readonly status: EngineJobStatus;
}

/** Minimal provider-neutral submission acknowledgement. */
interface EngineSubmission {
  readonly id: string;
}

/** Scheduler health literal union. */
type EngineHealth = (typeof ENGINE_HEALTH)[keyof typeof ENGINE_HEALTH];

/** Provider-neutral asynchronous job literal union. */
type EngineJobStatus =
  (typeof ENGINE_JOB_STATUS)[keyof typeof ENGINE_JOB_STATUS];

/** Mutable scheduler state for one engine instance. */
interface EngineRuntimeState {
  readonly consecutiveFailures: number;
  readonly health: EngineHealth;
  readonly openUntilEpochMs: number;
  readonly running: number;
}

/** Read-only public engine information. */
interface EngineView {
  readonly backend: EngineConfig["backend"];
  readonly health: EngineHealth;
  readonly id: string;
  readonly maxConcurrent: number;
  readonly models: readonly string[];
  readonly provider: EngineConfig["provider"];
  readonly running: number;
}

/** Capacity reservation returned atomically by the scheduler. */
interface EngineReservation {
  readonly engine: EngineConfig;
}

export type {
  EngineCapabilities,
  EngineHealth,
  EngineImageResult,
  EngineImageResultSet,
  EngineJob,
  EngineJobError,
  EngineJobStatus,
  EngineReservation,
  EngineRuntimeState,
  EngineSubmission,
  EngineView,
};
