import type { EngineConfig } from "@app/core/config/config.types";
import type {
  EngineHealth,
  EngineJobStatus,
} from "@app/infrastructure/engine/engine.constants";
import type { OutputFormatValue } from "@app/modules/jobs/job.types";

/** Provider-neutral engine capability contract used by readiness checks. */
interface EngineCapabilities {
  readonly outputFormats: readonly OutputFormatValue[];
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
  readonly outputFormat: OutputFormatValue;
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
  readonly status: EngineJobStatusValue;
}

/** Minimal provider-neutral submission acknowledgement. */
interface EngineSubmission {
  readonly id: string;
}

/** Scheduler health literal union. */
type EngineHealthValue = (typeof EngineHealth)[keyof typeof EngineHealth];

/** Provider-neutral asynchronous job literal union. */
type EngineJobStatusValue =
  (typeof EngineJobStatus)[keyof typeof EngineJobStatus];

/** Mutable scheduler state for one engine instance. */
interface EngineRuntimeState {
  readonly consecutiveFailures: number;
  readonly health: EngineHealthValue;
  readonly openUntilEpochMs: number;
  readonly running: number;
}

/** Read-only public engine information. */
interface EngineView {
  readonly backend: EngineConfig["backend"];
  readonly health: EngineHealthValue;
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
  EngineHealthValue,
  EngineImageResult,
  EngineImageResultSet,
  EngineJob,
  EngineJobError,
  EngineJobStatusValue,
  EngineReservation,
  EngineRuntimeState,
  EngineSubmission,
  EngineView,
};
