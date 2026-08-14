import type { JobStatus } from "@app/job/job.types.js";

/** Raw SQLite row for one persisted job. */
interface JobRow {
  readonly attempt: number;
  readonly cancelRequested: number;
  readonly cost: number;
  readonly createdAt: string;
  readonly engineId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly id: string;
  readonly leaseUntil: string | null;
  readonly model: string | null;
  readonly remoteJobId: string | null;
  readonly requestJson: string;
  readonly status: string;
  readonly updatedAt: string;
}

/** Raw SQLite row for one result metadata record. */
interface JobResultRow {
  readonly index: number;
  readonly jobId: string;
  readonly mimeType: string;
  readonly path: string;
  readonly sha256: string;
  readonly sizeBytes: number;
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
  readonly from: JobStatus;
  readonly id: string;
  readonly to: JobStatus;
}

export type { JobResultRow, JobRow, JobTransition, JobTransitionChanges };
