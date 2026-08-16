import { describe, expect, test } from "bun:test";
import { ConfigService } from "@app/core/config/config.service";
import type { PlatformConfig } from "@app/core/config/config.types";
import { ErrorTag } from "@app/core/errors/error.constants";
import type { ModelDownloadError } from "@app/core/errors/error.types";
import {
  ModelDownloader,
  type ModelDownloaderShape,
} from "@app/infrastructure/models/model-downloader.service";
import { FetchHttpClient } from "@effect/platform";
import { BunFileSystem } from "@effect/platform-bun";
import { createPlatformConfigFixture } from "@test/fixtures/platform.fixture";
import { Effect, Either, Layer } from "effect";

describe("model provisioning wiring", (): void => {
  test("reports a model directory it cannot create", async (): Promise<void> => {
    const base: PlatformConfig =
      createPlatformConfigFixture("/tmp/models-deny");
    const config: PlatformConfig = {
      ...base,
      modelSource: {
        directory: "/proc/nope/models",
        downloads: [
          { name: "demo.safetensors", url: "https://example.invalid/demo" },
        ],
      },
    };
    const outcome: Either.Either<void, ModelDownloadError> =
      await Effect.runPromise(
        Effect.either(
          ModelDownloader.pipe(
            Effect.flatMap(
              (
                downloader: ModelDownloaderShape,
              ): Effect.Effect<void, ModelDownloadError> => downloader.sync(),
            ),
            Effect.provide(
              ModelDownloader.Default.pipe(
                Layer.provide(
                  Layer.mergeAll(
                    Layer.succeed(ConfigService, config),
                    BunFileSystem.layer,
                    FetchHttpClient.layer,
                  ),
                ),
              ),
            ),
          ),
        ),
      );
    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) {
      expect(outcome.left._tag).toBe(ErrorTag.modelDownload);
    }
  });
});
