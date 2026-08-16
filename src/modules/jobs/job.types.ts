import type { JobStatus, OutputFormat } from "@app/modules/jobs/job.constants";

/** Persistent state machine status for one generation job. */
type JobStatusValue = (typeof JobStatus)[keyof typeof JobStatus];

/** Output image format supported by the public contract. */
type OutputFormatValue = (typeof OutputFormat)[keyof typeof OutputFormat];

/** Public image-generation request accepted by the platform. */
interface JobCreateRequest {
  readonly cfgScale: number;
  readonly count: number;
  readonly height: number;
  readonly model: string;
  readonly negativePrompt?: string;
  readonly outputFormat?: OutputFormatValue;
  readonly prompt: string;
  readonly seed?: number;
  readonly steps: number;
  readonly width: number;
}

/** Durable representation of one accepted job. */
interface Job {
  readonly attempt: number;
  readonly cancelRequested: boolean;
  readonly cost: number;
  readonly createdAt: string;
  readonly engineId?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly id: string;
  readonly leaseUntil?: string;
  readonly remoteJobId?: string;
  readonly request: JobCreateRequest;
  readonly startedAt?: string;
  readonly status: JobStatusValue;
  readonly updatedAt: string;
}

/** Persisted metadata describing one generated result file. */
interface JobResult {
  readonly index: number;
  readonly jobId: string;
  readonly mimeType: string;
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

/** Minimal queue head used by the dispatcher before reserving an engine. */
interface QueuedJobHead {
  readonly id: string;
  readonly model: string;
}

/** Safe caller-facing failure descriptor independent of infrastructure details. */
interface JobResponseError {
  readonly code: string;
  readonly message: string;
}

/** Public job response with internal scheduler and engine metadata removed. */
interface JobResponse {
  readonly cancelRequested: boolean;
  readonly createdAt: string;
  readonly error: JobResponseError | null;
  readonly id: string;
  readonly request: JobCreateRequest;
  readonly resultUrls: readonly string[];
  readonly startedAt: string | null;
  readonly status: JobStatusValue;
  readonly updatedAt: string;
}

/** Mutable fields accepted by an atomic job transition. */
interface JobTransitionChanges {
  readonly cancelRequested?: boolean;
  readonly engineId?: string | null;
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly leaseUntil?: string | null;
  readonly remoteJobId?: string | null;
}

/** Atomic transition request persisted by the repository. */
interface JobTransition {
  readonly changes: JobTransitionChanges;
  readonly from: JobStatusValue;
  readonly id: string;
  readonly to: JobStatusValue;
}

export type {
  Job,
  JobCreateRequest,
  JobResponse,
  JobResponseError,
  JobResult,
  JobStatusValue,
  JobTransition,
  JobTransitionChanges,
  OutputFormatValue,
  QueuedJobHead,
};
