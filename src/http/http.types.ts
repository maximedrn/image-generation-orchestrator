import type { EngineView } from "@app/engine/engine.types.js";

/** Stable public error response. */
interface PublicErrorResponse {
  readonly code: string;
  readonly message: string;
  readonly retryAfterSeconds?: number;
}

/** Liveness response. */
interface HealthLiveResponse {
  readonly status: "live";
}

/** Readiness response. */
interface HealthReadyResponse {
  readonly enginesAvailable: number;
  readonly status: "ready";
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
