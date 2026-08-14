import { FileSystem } from "@effect/platform/FileSystem";
import { Context, Effect, Layer, Stream } from "effect";

import { EFFECT_SERVICE_IDENTIFIER } from "@app/runtime/runtime.constants.js";
import { ConfigService } from "@app/config/config.service.js";
import type { PlatformConfig } from "@app/config/config.types.js";
import { StorageError } from "@app/error/error.types.js";
import {
  OUTPUT_EXTENSION,
  OUTPUT_MIME_TYPE,
} from "@app/job/job.constants.js";
import type { JobResult, OutputFormat } from "@app/job/job.types.js";
import type {
  ResultStorageShape,
  StoredResult,
} from "@app/storage/storage.interface.js";

/** Effect Context tag for generated-result persistence. */
class ResultStorage extends Context.Tag(EFFECT_SERVICE_IDENTIFIER.RESULT_STORAGE)<
  ResultStorage,
  ResultStorageShape
>() {}

/**
 * Converts base64 output from an inference engine to bytes.
 *
 * @param base64 - (string) Base64 payload without a data URL prefix.
 * @returns (Uint8Array) Decoded bytes.
 */
const decodeBase64 = (base64: string): Uint8Array =>
  new Uint8Array(Buffer.from(base64, "base64"));

/**
 * Computes a SHA-256 digest using Bun's native hashing implementation.
 *
 * @param bytes - (Uint8Array) Result bytes.
 * @returns (string) Lower-case hexadecimal SHA-256 digest.
 */
const computeSha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/**
 * Maps storage filesystem errors to the explicit application error channel.
 *
 * @param message - (string) Stable operator-facing context.
 * @returns ((cause: unknown) => StorageError) Mapping function.
 */
const mapStorageError = (message: string): ((cause: unknown) => StorageError) =>
  (cause: unknown): StorageError => new StorageError({ cause, message });

/**
 * Best-effort removal of a temporary result file after a failed publication.
 *
 * Cleanup failures are intentionally ignored so the original storage failure
 * remains the only error exposed to callers.
 *
 * @param fileSystem - (FileSystem) Effect filesystem adapter.
 * @param temporaryPath - (string) Temporary file path to remove.
 * @returns (Effect.Effect<void>) Best-effort cleanup effect.
 */
const removeTemporaryResult = (
  fileSystem: FileSystem,
  temporaryPath: string,
): Effect.Effect<void> =>
  fileSystem.remove(temporaryPath).pipe(Effect.catchAll((): Effect.Effect<void> => Effect.void));

/**
 * Reads one stored result as a streaming response.
 *
 * @param fileSystem - (FileSystem) Effect filesystem adapter.
 * @param metadata - (JobResult) Durable result metadata.
 * @returns (Effect.Effect<StoredResult, StorageError>) Streaming stored result.
 */
const readStoredResult = (
  fileSystem: FileSystem,
  metadata: JobResult,
): Effect.Effect<StoredResult, StorageError> =>
  Effect.gen(function* readStoredResultEffect(): Generator<unknown, StoredResult> {
    const exists: boolean = yield* fileSystem.exists(metadata.path).pipe(
      Effect.mapError(mapStorageError(`cannot access result ${metadata.path}`)),
    );
    if (!exists) {
      return yield* Effect.fail(
        new StorageError({ message: `result file is missing: ${metadata.path}` }),
      );
    }
    const stream: ReadableStream<Uint8Array> = yield* Stream.toReadableStreamEffect(
      fileSystem.stream(metadata.path).pipe(
        Stream.mapError(mapStorageError(`cannot stream result ${metadata.path}`)),
      ),
    );
    return { metadata, stream };
  });

/**
 * Removes one published result file.
 *
 * @param fileSystem - (FileSystem) Effect filesystem adapter.
 * @param metadata - (JobResult) Durable result metadata identifying the file.
 * @returns (Effect.Effect<void, StorageError>) Removal effect.
 */
const removeStoredResult = (
  fileSystem: FileSystem,
  metadata: JobResult,
): Effect.Effect<void, StorageError> =>
  fileSystem.remove(metadata.path).pipe(
    Effect.mapError(mapStorageError(`cannot remove result ${metadata.path}`)),
  );

/**
 * Atomically persists one base64 engine result and returns durable metadata.
 *
 * @param config - (PlatformConfig) Resolved platform configuration.
 * @param fileSystem - (FileSystem) Effect filesystem adapter.
 * @param jobId - (string) Owning job identifier.
 * @param index - (number) Result index inside the generated batch.
 * @param outputFormat - (OutputFormat) Requested output format.
 * @param base64 - (string) Engine result payload.
 * @returns (Effect.Effect<JobResult, StorageError>) Persisted result metadata.
 */
const writeStoredResult = (
  config: PlatformConfig,
  fileSystem: FileSystem,
  jobId: string,
  index: number,
  outputFormat: OutputFormat,
  base64: string,
): Effect.Effect<JobResult, StorageError> =>
  Effect.gen(function* writeStoredResultEffect(): Generator<unknown, JobResult> {
    const resultDirectory: string = `${config.storage.root}/results/${jobId}`;
    const extension: string = OUTPUT_EXTENSION[outputFormat];
    const finalPath: string = `${resultDirectory}/${index}.${extension}`;
    const temporaryPath: string = `${finalPath}.${crypto.randomUUID()}.tmp`;
    const bytes: Uint8Array = decodeBase64(base64);
    yield* fileSystem.makeDirectory(resultDirectory, { recursive: true }).pipe(
      Effect.mapError(mapStorageError(`cannot create ${resultDirectory}`)),
    );
    const publishResult: Effect.Effect<void, StorageError> = fileSystem
      .writeFile(temporaryPath, bytes)
      .pipe(
        Effect.mapError(mapStorageError(`cannot write ${temporaryPath}`)),
        Effect.zipRight(
          fileSystem.rename(temporaryPath, finalPath).pipe(
            Effect.mapError(mapStorageError(`cannot publish ${finalPath}`)),
          ),
        ),
        Effect.tapError(
          (): Effect.Effect<void> => removeTemporaryResult(fileSystem, temporaryPath),
        ),
      );
    yield* publishResult;
    return {
      index,
      jobId,
      mimeType: OUTPUT_MIME_TYPE[outputFormat],
      path: finalPath,
      sha256: computeSha256(bytes),
      sizeBytes: bytes.byteLength,
    };
  });

/**
 * Builds the local atomic-file storage implementation.
 *
 * @param config - (PlatformConfig) Resolved platform config.
 * @param fileSystem - (FileSystem) Effect filesystem adapter.
 * @returns (ResultStorageShape) Storage implementation.
 */
const createResultStorage = (
  config: PlatformConfig,
  fileSystem: FileSystem,
): ResultStorageShape => ({
  read: (metadata: JobResult): Effect.Effect<StoredResult, StorageError> =>
    readStoredResult(fileSystem, metadata),
  remove: (metadata: JobResult): Effect.Effect<void, StorageError> =>
    removeStoredResult(fileSystem, metadata),
  writeBase64: (
    jobId: string,
    index: number,
    outputFormat: OutputFormat,
    base64: string,
  ): Effect.Effect<JobResult, StorageError> =>
    writeStoredResult(config, fileSystem, jobId, index, outputFormat, base64),
});

/** Live local result-storage layer backed by Effect's Bun filesystem. */
const ResultStorageLive: Layer.Layer<
  ResultStorage,
  never,
  ConfigService | FileSystem
> = Layer.effect(
  ResultStorage,
  Effect.gen(function* resultStorageLayerEffect(): Generator<unknown, ResultStorageShape> {
    const config: PlatformConfig = yield* ConfigService;
    const fileSystem: FileSystem = yield* FileSystem;
    return createResultStorage(config, fileSystem);
  }),
);

export {
  computeSha256,
  createResultStorage,
  decodeBase64,
  readStoredResult,
  removeStoredResult,
  removeTemporaryResult,
  writeStoredResult,
  ResultStorage,
  ResultStorageLive,
};
