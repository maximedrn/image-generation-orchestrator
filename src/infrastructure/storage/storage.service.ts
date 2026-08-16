import { ConfigService } from "@app/core/config/config.service";
import type { PlatformConfig } from "@app/core/config/config.types";
import { StorageError } from "@app/core/errors/error.types";
import { PayloadEncoding } from "@app/core/runtime/runtime.constants";
import { ServiceTag } from "@app/core/runtime/service.constants";
import { ContentDigest } from "@app/core/security/security.constants";
import {
  StorageLayout,
  StorageMessage,
} from "@app/infrastructure/storage/storage.constants";
import type {
  ResultStorageShape,
  StoredResult,
} from "@app/infrastructure/storage/storage.interface";
import {
  OutputExtension,
  OutputMimeType,
} from "@app/modules/jobs/job.constants";
import type { JobResult, OutputFormatValue } from "@app/modules/jobs/job.types";
import { FileSystem } from "@effect/platform/FileSystem";
import { Effect, Stream } from "effect";

/**
 * Converts base64 output from an inference engine to bytes.
 *
 * @param {string} base64 - Base64 payload without a data URL prefix.
 * @returns {Uint8Array} Decoded bytes.
 */
const decodeBase64 = (base64: string): Uint8Array =>
  new Uint8Array(Buffer.from(base64, PayloadEncoding.base64));

/**
 * Computes a SHA-256 digest using Bun's native hashing implementation.
 *
 * @param {Uint8Array} bytes - Result bytes.
 * @returns {string} Lower-case hexadecimal SHA-256 digest.
 */
const computeSha256 = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher(ContentDigest.algorithm)
    .update(bytes)
    .digest(ContentDigest.encoding);

/**
 * Maps storage filesystem errors to the explicit application error channel.
 *
 * @param {string} message - Stable operator-facing context.
 * @returns {(cause: unknown) => StorageError} Mapping function.
 */
const mapStorageError =
  (message: string): ((cause: unknown) => StorageError) =>
  (cause: unknown): StorageError =>
    new StorageError({ cause, message });

/**
 * Best-effort removal of a temporary result file after a failed publication.
 *
 * Cleanup failures are intentionally ignored so the original storage failure
 * remains the only error exposed to callers.
 *
 * @param {FileSystem} fileSystem - Effect filesystem adapter.
 * @param {string} temporaryPath - Temporary file path to remove.
 * @returns {Effect.Effect<void>} Best-effort cleanup effect.
 */
const removeTemporaryResult = (
  fileSystem: FileSystem,
  temporaryPath: string,
): Effect.Effect<void> =>
  fileSystem
    .remove(temporaryPath)
    .pipe(Effect.catchAll((): Effect.Effect<void> => Effect.void));

/**
 * Reads one stored result as a streaming response.
 *
 * @param {FileSystem} fileSystem - Effect filesystem adapter.
 * @param {JobResult} metadata - Durable result metadata.
 * @returns {Effect.Effect<StoredResult, StorageError>} Streaming stored result.
 */
const readStoredResult = (
  fileSystem: FileSystem,
  metadata: JobResult,
): Effect.Effect<StoredResult, StorageError> =>
  Effect.gen(function* readStoredResultEffect() {
    const exists: boolean = yield* fileSystem
      .exists(metadata.path)
      .pipe(
        Effect.mapError(
          mapStorageError(
            `${StorageMessage.accessFailed}${StorageLayout.messageSeparator}${metadata.path}`,
          ),
        ),
      );
    if (!exists) {
      return yield* Effect.fail(
        new StorageError({
          message: `${StorageMessage.missingFile}${StorageLayout.messageSeparator}${metadata.path}`,
        }),
      );
    }
    const stream: ReadableStream<Uint8Array> =
      yield* Stream.toReadableStreamEffect(
        fileSystem
          .stream(metadata.path)
          .pipe(
            Stream.mapError(
              mapStorageError(
                `${StorageMessage.streamFailed}${StorageLayout.messageSeparator}${metadata.path}`,
              ),
            ),
          ),
      );
    return { metadata, stream };
  });

/**
 * Removes one published result file.
 *
 * @param {FileSystem} fileSystem - Effect filesystem adapter.
 * @param {JobResult} metadata - Durable result metadata identifying the file.
 * @returns {Effect.Effect<void, StorageError>} Removal effect.
 */
const removeStoredResult = (
  fileSystem: FileSystem,
  metadata: JobResult,
): Effect.Effect<void, StorageError> =>
  fileSystem
    .remove(metadata.path)
    .pipe(
      Effect.mapError(
        mapStorageError(
          `${StorageMessage.removeFailed}${StorageLayout.messageSeparator}${metadata.path}`,
        ),
      ),
    );

/**
 * Atomically persists one base64 engine result and returns durable metadata.
 *
 * @param {PlatformConfig} config - Resolved platform configuration.
 * @param {FileSystem} fileSystem - Effect filesystem adapter.
 * @param {string} jobId - Owning job identifier.
 * @param {number} index - Result index inside the generated batch.
 * @param {OutputFormatValue} outputFormat - Requested output format.
 * @param {string} base64 - Engine result payload.
 * @returns {Effect.Effect<JobResult, StorageError>} Persisted result metadata.
 */
const writeStoredResult = (
  config: PlatformConfig,
  fileSystem: FileSystem,
  jobId: string,
  index: number,
  outputFormat: OutputFormatValue,
  base64: string,
): Effect.Effect<JobResult, StorageError> =>
  Effect.gen(function* writeStoredResultEffect() {
    const resultDirectory: string = `${config.storage.root}${StorageLayout.pathSeparator}${StorageLayout.resultsDirectory}${StorageLayout.pathSeparator}${jobId}`;
    const extension: string = OutputExtension[outputFormat];
    const finalPath: string = `${resultDirectory}${StorageLayout.pathSeparator}${index}${StorageLayout.extensionSeparator}${extension}`;
    const temporaryPath: string = `${finalPath}${StorageLayout.extensionSeparator}${crypto.randomUUID()}${StorageLayout.temporarySuffix}`;
    const bytes: Uint8Array = decodeBase64(base64);
    yield* fileSystem
      .makeDirectory(resultDirectory, { recursive: true })
      .pipe(
        Effect.mapError(
          mapStorageError(
            `${StorageMessage.createDirectoryFailed}${StorageLayout.messageSeparator}${resultDirectory}`,
          ),
        ),
      );
    const publishResult: Effect.Effect<void, StorageError> = fileSystem
      .writeFile(temporaryPath, bytes)
      .pipe(
        Effect.mapError(
          mapStorageError(
            `${StorageMessage.writeFailed}${StorageLayout.messageSeparator}${temporaryPath}`,
          ),
        ),
        Effect.zipRight(
          fileSystem
            .rename(temporaryPath, finalPath)
            .pipe(
              Effect.mapError(
                mapStorageError(
                  `${StorageMessage.publishFailed}${StorageLayout.messageSeparator}${finalPath}`,
                ),
              ),
            ),
        ),
        Effect.tapError(
          (): Effect.Effect<void> =>
            removeTemporaryResult(fileSystem, temporaryPath),
        ),
      );
    yield* publishResult;
    return {
      index,
      jobId,
      mimeType: OutputMimeType[outputFormat],
      path: finalPath,
      sha256: computeSha256(bytes),
      sizeBytes: bytes.byteLength,
    };
  });

/**
 * Builds the local atomic-file storage implementation.
 *
 * @param {PlatformConfig} config - Resolved platform config.
 * @param {FileSystem} fileSystem - Effect filesystem adapter.
 * @returns {ResultStorageShape} Storage implementation.
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
    outputFormat: OutputFormatValue,
    base64: string,
  ): Effect.Effect<JobResult, StorageError> =>
    writeStoredResult(config, fileSystem, jobId, index, outputFormat, base64),
});

/** Local atomic-file storage for generated results. */
class ResultStorage extends Effect.Service<ResultStorage>()(
  ServiceTag.resultStorage,
  {
    effect: Effect.all([ConfigService, FileSystem]).pipe(
      Effect.map(
        ([config, fileSystem]: readonly [
          PlatformConfig,
          FileSystem,
        ]): ResultStorageShape => createResultStorage(config, fileSystem),
      ),
    ),
  },
) {}

export {
  computeSha256,
  createResultStorage,
  decodeBase64,
  ResultStorage,
  readStoredResult,
  removeStoredResult,
  removeTemporaryResult,
  writeStoredResult,
};
