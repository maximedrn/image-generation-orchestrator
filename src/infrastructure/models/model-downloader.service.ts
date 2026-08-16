import { ConfigService } from "@app/core/config/config.service";
import type {
  ModelDownload,
  ModelsConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { ModelDownloadError } from "@app/core/errors/error.types";
import { ServiceTag } from "@app/core/runtime/service.constants";
import { ContentDigest } from "@app/core/security/security.constants";
import {
  ModelDownloadMessage,
  ModelDownloadPolicy,
} from "@app/infrastructure/models/models.constants";
import { HttpClient, type HttpClientResponse } from "@effect/platform";
import { FileSystem } from "@effect/platform/FileSystem";
import { Effect, Option, Stream } from "effect";

/** Model provisioning port invoked once before the HTTP listener opens. */
interface ModelDownloaderShape {
  readonly sync: () => Effect.Effect<void, ModelDownloadError>;
}

/**
 * Maps any failure raised while fetching one artefact to the typed channel.
 *
 * @param {ModelDownload} model - Declared artefact being fetched.
 * @param {string} message - Stable operator-facing context.
 * @returns {(cause: unknown) => ModelDownloadError} Mapping function.
 */
const mapDownloadError =
  (model: ModelDownload, message: string) =>
  (cause: unknown): ModelDownloadError =>
    new ModelDownloadError({ cause, message, model: model.name });

/**
 * Streams one artefact to a temporary file, then publishes it atomically.
 *
 * Nothing is buffered in memory: the response body flows straight into the
 * filesystem sink, so multi-gigabyte checkpoints cost a constant amount of RAM.
 *
 * @param {HttpClient.HttpClient} client - Effect HTTP client.
 * @param {FileSystem} fileSystem - Effect filesystem adapter.
 * @param {ModelDownload} model - Declared artefact to fetch.
 * @param {string} targetPath - Final path inside the model directory.
 * @returns {Effect.Effect<void, ModelDownloadError>} Download effect.
 */
const fetchModel = (
  client: HttpClient.HttpClient,
  fileSystem: FileSystem,
  model: ModelDownload,
  targetPath: string,
): Effect.Effect<void, ModelDownloadError> => {
  const temporaryPath: string = `${targetPath}${ModelDownloadPolicy.temporarySuffix}`;
  return Effect.logInfo(ModelDownloadMessage.downloading, {
    model: model.name,
    url: model.url,
  }).pipe(
    Effect.zipRight(client.get(model.url)),
    Effect.mapError(
      mapDownloadError(model, ModelDownloadMessage.requestFailed),
    ),
    Effect.flatMap(
      (
        response: HttpClientResponse.HttpClientResponse,
      ): Effect.Effect<void, ModelDownloadError> =>
        response.status === ModelDownloadPolicy.expectedStatus
          ? response.stream.pipe(
              Stream.run(fileSystem.sink(temporaryPath)),
              Effect.mapError(
                mapDownloadError(model, ModelDownloadMessage.writeFailed),
              ),
            )
          : Effect.fail(
              new ModelDownloadError({
                message: `${ModelDownloadMessage.rejected} ${response.status}`,
                model: model.name,
              }),
            ),
    ),
    Effect.zipRight(
      fileSystem
        .rename(temporaryPath, targetPath)
        .pipe(
          Effect.mapError(
            mapDownloadError(model, ModelDownloadMessage.publishFailed),
          ),
        ),
    ),
    Effect.tapError(
      (): Effect.Effect<void> =>
        fileSystem.remove(temporaryPath).pipe(Effect.ignore),
    ),
    Effect.scoped,
  );
};

/**
 * Fetches one declared artefact unless the target file already exists.
 *
 * @param {HttpClient.HttpClient} client - Effect HTTP client.
 * @param {FileSystem} fileSystem - Effect filesystem adapter.
 * @param {string} directory - Local model directory.
 * @param {ModelDownload} model - Declared artefact to provision.
 * @returns {Effect.Effect<void, ModelDownloadError>} Idempotent provisioning effect.
 */
const provisionModel = (
  client: HttpClient.HttpClient,
  fileSystem: FileSystem,
  directory: string,
  model: ModelDownload,
): Effect.Effect<void, ModelDownloadError> => {
  const targetPath: string = `${directory}/${model.name}`;
  return fileSystem.exists(targetPath).pipe(
    Effect.mapError(
      mapDownloadError(model, ModelDownloadMessage.unreadableDirectory),
    ),
    Effect.flatMap(
      (present: boolean): Effect.Effect<void, ModelDownloadError> =>
        present
          ? Effect.logInfo(ModelDownloadMessage.skipped, { model: model.name })
          : fetchModel(client, fileSystem, model, targetPath).pipe(
              Effect.zipRight(verifyDigest(fileSystem, model, targetPath)),
            ),
    ),
  );
};

/**
 * Verifies the declared SHA-256 digest when the operator provided one.
 *
 * @param {FileSystem} fileSystem - Effect filesystem adapter.
 * @param {ModelDownload} model - Declared artefact.
 * @param {string} targetPath - Published artefact path.
 * @returns {Effect.Effect<void, ModelDownloadError>} Integrity check effect.
 */
const verifyDigest = (
  fileSystem: FileSystem,
  model: ModelDownload,
  targetPath: string,
): Effect.Effect<void, ModelDownloadError> =>
  Option.match(Option.fromNullable(model.sha256), {
    onNone: (): Effect.Effect<void, ModelDownloadError> => Effect.void,
    onSome: (expected: string): Effect.Effect<void, ModelDownloadError> =>
      fileSystem.readFile(targetPath).pipe(
        Effect.mapError(
          mapDownloadError(model, ModelDownloadMessage.writeFailed),
        ),
        Effect.flatMap(
          (bytes: Uint8Array): Effect.Effect<void, ModelDownloadError> =>
            new Bun.CryptoHasher(ContentDigest.algorithm)
              .update(bytes)
              .digest(ContentDigest.encoding) === expected
              ? Effect.void
              : fileSystem.remove(targetPath).pipe(
                  Effect.ignore,
                  Effect.zipRight(
                    Effect.fail(
                      new ModelDownloadError({
                        message: ModelDownloadMessage.digestMismatch,
                        model: model.name,
                      }),
                    ),
                  ),
                ),
        ),
      ),
  });

/**
 * Provisions every declared artefact into the configured model directory.
 *
 * @param {HttpClient.HttpClient} client - Effect HTTP client.
 * @param {FileSystem} fileSystem - Effect filesystem adapter.
 * @param {ModelsConfig} models - Model directory and declared artefacts.
 * @returns {Effect.Effect<void, ModelDownloadError>} Synchronisation effect.
 */
const syncModels = (
  client: HttpClient.HttpClient,
  fileSystem: FileSystem,
  models: ModelsConfig,
): Effect.Effect<void, ModelDownloadError> =>
  models.downloads.length === 0
    ? Effect.void
    : fileSystem.makeDirectory(models.directory, { recursive: true }).pipe(
        Effect.mapError(
          (cause: unknown): ModelDownloadError =>
            new ModelDownloadError({
              cause,
              message: ModelDownloadMessage.unreadableDirectory,
              model: models.directory,
            }),
        ),
        Effect.zipRight(
          Effect.forEach(
            models.downloads,
            (model: ModelDownload): Effect.Effect<void, ModelDownloadError> =>
              provisionModel(client, fileSystem, models.directory, model),
            {
              concurrency: ModelDownloadPolicy.concurrency,
              discard: true,
            },
          ),
        ),
      );

/** Idempotent provisioning of every model declared in the environment. */
class ModelDownloader extends Effect.Service<ModelDownloader>()(
  ServiceTag.modelDownloader,
  {
    effect: Effect.all([ConfigService, FileSystem, HttpClient.HttpClient]).pipe(
      Effect.map(
        ([config, fileSystem, client]: readonly [
          PlatformConfig,
          FileSystem,
          HttpClient.HttpClient,
        ]): ModelDownloaderShape => ({
          sync: (): Effect.Effect<void, ModelDownloadError> =>
            syncModels(client, fileSystem, config.modelSource),
        }),
      ),
    ),
  },
) {}

export type { ModelDownloaderShape };
export {
  fetchModel,
  ModelDownloader,
  provisionModel,
  syncModels,
  verifyDigest,
};
