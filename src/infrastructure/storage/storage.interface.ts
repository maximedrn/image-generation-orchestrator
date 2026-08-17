import type { StorageError } from "@app/core/errors/error.types";
import type { JobResult, OutputFormatValue } from "@app/modules/jobs/job.types";
import type { Effect } from "effect";

/** Binary result stream opened from durable storage. */
interface StoredResult {
  readonly metadata: JobResult;
  readonly stream: ReadableStream<Uint8Array>;
}

/** Storage port isolating local files from application orchestration. */
interface ResultStorageShape {
  /** Opens one stored image as a stream, so nothing is held in memory. */
  readonly read: (
    metadata: JobResult,
  ) => Effect.Effect<StoredResult, StorageError>;
  /** Deletes one stored image, tolerating a file that is already gone. */
  readonly remove: (metadata: JobResult) => Effect.Effect<void, StorageError>;
  /** Stores one image the engine returned, returning its durable metadata. */
  readonly writeBase64: (
    jobId: string,
    index: number,
    outputFormat: OutputFormatValue,
    base64: string,
  ) => Effect.Effect<JobResult, StorageError>;
}

export type { ResultStorageShape, StoredResult };
