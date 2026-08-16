import { describe, expect, test } from "bun:test";
import type { ModelsConfig } from "@app/core/config/config.types";
import type { ModelDownloadError } from "@app/core/errors/error.types";
import { syncModels } from "@app/infrastructure/models/model-downloader.service";
import { FetchHttpClient, HttpClient } from "@effect/platform";
import { FileSystem } from "@effect/platform/FileSystem";
import { BunFileSystem } from "@effect/platform-bun";
import { TestArtefact } from "@test/fixtures/test.constants";
import { Effect, Exit, Layer } from "effect";

/** Payload served by the stub model origin. */
const ModelBody: string = "model-bytes";

/** Platform layer providing the Bun filesystem and a real HTTP client. */
const PlatformLayer: Layer.Layer<FileSystem | HttpClient.HttpClient> =
  Layer.merge(BunFileSystem.layer, FetchHttpClient.layer);

/**
 * Serves one in-process origin for the duration of a download test.
 *
 * @param {number} status - HTTP status returned for every request.
 * @param {string} body - Response payload.
 * @returns {Bun.Server<undefined>} Listening stub server.
 */
const startOrigin = (status: number, body: string): Bun.Server<undefined> =>
  Bun.serve({
    fetch: (): Response => new Response(body, { status }),
    port: 0,
  });

/**
 * Runs one synchronisation against a disposable model directory.
 *
 * @param {ModelsConfig} models - Directory and declared artefacts.
 * @returns {Promise<Exit.Exit<void, ModelDownloadError>>} Synchronisation outcome.
 */
const runSync = (
  models: ModelsConfig,
): Promise<Exit.Exit<void, ModelDownloadError>> =>
  Effect.runPromiseExit(
    Effect.all([HttpClient.HttpClient, FileSystem]).pipe(
      Effect.flatMap(
        ([client, fileSystem]: readonly [
          HttpClient.HttpClient,
          FileSystem,
        ]): Effect.Effect<void, ModelDownloadError> =>
          syncModels(client, fileSystem, models),
      ),
      Effect.provide(PlatformLayer),
    ),
  );

describe("model downloader", (): void => {
  test("streams a declared model into the model directory", async (): Promise<void> => {
    const origin: Bun.Server<undefined> = startOrigin(200, ModelBody);
    const directory: string = `/tmp/platform-models-${crypto.randomUUID()}`;
    const exit: Exit.Exit<void, ModelDownloadError> = await runSync({
      directory,
      downloads: [
        {
          name: TestArtefact.modelFileName,
          url: `${origin.url}model.safetensors`,
        },
      ],
    });
    await origin.stop(true);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await Bun.file(`${directory}/model.safetensors`).text()).toBe(
      ModelBody,
    );
  });

  test("skips a model that is already present", async (): Promise<void> => {
    const directory: string = `/tmp/platform-models-${crypto.randomUUID()}`;
    await Bun.write(`${directory}/model.safetensors`, "existing");
    const origin: Bun.Server<undefined> = startOrigin(
      500,
      "should not be requested",
    );
    const exit: Exit.Exit<void, ModelDownloadError> = await runSync({
      directory,
      downloads: [
        {
          name: TestArtefact.modelFileName,
          url: `${origin.url}model.safetensors`,
        },
      ],
    });
    await origin.stop(true);
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await Bun.file(`${directory}/model.safetensors`).text()).toBe(
      "existing",
    );
  });

  test("fails and publishes nothing when the origin rejects the request", async (): Promise<void> => {
    const origin: Bun.Server<undefined> = startOrigin(404, "missing");
    const directory: string = `/tmp/platform-models-${crypto.randomUUID()}`;
    const exit: Exit.Exit<void, ModelDownloadError> = await runSync({
      directory,
      downloads: [
        {
          name: TestArtefact.modelFileName,
          url: `${origin.url}model.safetensors`,
        },
      ],
    });
    await origin.stop(true);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(await Bun.file(`${directory}/model.safetensors`).exists()).toBe(
      false,
    );
  });

  test("rejects a model whose digest does not match the declaration", async (): Promise<void> => {
    const origin: Bun.Server<undefined> = startOrigin(200, ModelBody);
    const directory: string = `/tmp/platform-models-${crypto.randomUUID()}`;
    const exit: Exit.Exit<void, ModelDownloadError> = await runSync({
      directory,
      downloads: [
        {
          name: TestArtefact.modelFileName,
          sha256: "0".repeat(64),
          url: `${origin.url}model.safetensors`,
        },
      ],
    });
    await origin.stop(true);
    expect(Exit.isFailure(exit)).toBe(true);
    expect(await Bun.file(`${directory}/model.safetensors`).exists()).toBe(
      false,
    );
  });

  test("does nothing when no model is declared", async (): Promise<void> => {
    const exit: Exit.Exit<void, ModelDownloadError> = await runSync({
      directory: `/tmp/platform-models-${crypto.randomUUID()}`,
      downloads: [],
    });
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
