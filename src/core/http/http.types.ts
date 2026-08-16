import type { EngineView } from "@app/infrastructure/engine/engine.types";
import { HealthStatus } from "@app/modules/health/health.constants";

/** Stable public error response. */
interface PublicErrorResponse {
  readonly code: string;
  readonly message: string;
  readonly retryAfterSeconds?: number;
}

/** Liveness response. */
interface HealthLiveResponse {
  readonly status: typeof HealthStatus.live;
}

/** Readiness response. */
interface HealthReadyResponse {
  readonly enginesAvailable: number;
  readonly status: typeof HealthStatus.ready;
}

/** Lightweight operational metrics response without prompt or secret data. */
interface MetricsResponse {
  readonly engines: readonly EngineView[];
  readonly queuedJobs: number;
}

export type {
  HealthLiveResponse,
  HealthReadyResponse,
  MetricsResponse,
  PublicErrorResponse,
};
