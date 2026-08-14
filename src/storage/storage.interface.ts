import type { Effect } from "effect";

import type { StorageError } from "@app/error/error.types.js";
import type { JobResult, OutputFormat } from "@app/job/job.types.js";

/** Binary result stream opened from durable storage. */
interface StoredResult {
  readonly metadata: JobResult;
  readonly stream: ReadableStream<Uint8Array>;
}

/** Storage port isolating local files from application orchestration. */
interface ResultStorageShape {
  readonly read: (metadata: JobResult) => Effect.Effect<StoredResult, StorageError>;
  readonly remove: (metadata: JobResult) => Effect.Effect<void, StorageError>;
  readonly writeBase64: (
    jobId: string,
    index: number,
    outputFormat: OutputFormat,
    base64: string,
  ) => Effect.Effect<JobResult, StorageError>;
}

export type { ResultStorageShape, StoredResult };
