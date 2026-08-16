import { describe, expect, test } from "bun:test";
import type { ModelsConfig } from "@app/core/config/config.types";
import type { ModelDownloadError } from "@app/core/errors/error.types";
import { ContentDigest } from "@app/core/security/security.constants";
import { syncModels } from "@app/infrastructure/models/model-downloader.service";
import { ModelDownloadPolicy } from "@app/infrastructure/models/models.constants";
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

describe("model integrity verification", (): void => {
  test("publishes a model whose digest matches the declaration", async (): Promise<void> => {
    // Several megabytes so the body spans many stream chunks: the digest has to
    // be folded incrementally rather than computed over one buffered array.
    const body: string = "sdxl-checkpoint-".repeat(300_000);
    const expected: string = new Bun.CryptoHasher(ContentDigest.algorithm)
      .update(body)
      .digest(ContentDigest.encoding);
    const origin: Bun.Server<undefined> = startOrigin(200, body);
    const directory: string = `/tmp/platform-models-${crypto.randomUUID()}`;
    const exit: Exit.Exit<void, ModelDownloadError> = await runSync({
      directory,
      downloads: [
        {
          name: TestArtefact.modelFileName,
          sha256: expected,
          url: `${origin.url}model.safetensors`,
        },
      ],
    });
    await origin.stop(true);
    const published: string = `${directory}/${TestArtefact.modelFileName}`;
    const partial: string = `${published}${ModelDownloadPolicy.temporarySuffix}`;
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await Bun.file(published).exists()).toBe(true);
    expect(await Bun.file(published).text()).toBe(body);
    // The temporary file is renamed, never left behind.
    expect(await Bun.file(partial).exists()).toBe(false);
  });

  test("leaves nothing behind when the digest cannot be honoured", async (): Promise<void> => {
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
    const published: string = `${directory}/${TestArtefact.modelFileName}`;
    const partial: string = `${published}${ModelDownloadPolicy.temporarySuffix}`;
    expect(Exit.isFailure(exit)).toBe(true);
    // Neither path survives, so the next run cannot mistake it for provisioned.
    expect(await Bun.file(published).exists()).toBe(false);
    expect(await Bun.file(partial).exists()).toBe(false);
  });
});

describe("provisioning of a model already on disk", (): void => {
  test("trusts a file already at the target path without re-reading it", async (): Promise<void> => {
    // The origin would fail any request: a present file must not be fetched,
    // and its content must not be re-hashed either.
    const origin: Bun.Server<undefined> = startOrigin(500, "must not be read");
    const directory: string = `/tmp/platform-models-${crypto.randomUUID()}`;
    const published: string = `${directory}/${TestArtefact.modelFileName}`;
    await Bun.write(published, "content that does not match the digest");
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
    // Verification happens once, before publication; it is not repeated here.
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(await Bun.file(published).text()).toBe(
      "content that does not match the digest",
    );
  });

  test("accepts a file already on disk when no digest is declared", async (): Promise<void> => {
    const origin: Bun.Server<undefined> = startOrigin(500, "must not be read");
    const directory: string = `/tmp/platform-models-${crypto.randomUUID()}`;
    const published: string = `${directory}/${TestArtefact.modelFileName}`;
    await Bun.write(published, "whatever-the-operator-put-there");
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
    expect(await Bun.file(published).text()).toBe(
      "whatever-the-operator-put-there",
    );
  });
});
