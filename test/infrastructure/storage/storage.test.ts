import { describe, expect, test } from "bun:test";
import { ConfigService } from "@app/core/config/config.service";
import type { PlatformConfig } from "@app/core/config/config.types";
import type { StorageError } from "@app/core/errors/error.types";
import type {
  ResultStorageShape,
  StoredResult,
} from "@app/infrastructure/storage/storage.interface";
import { ResultStorage } from "@app/infrastructure/storage/storage.service";
import { OutputFormat } from "@app/modules/jobs/job.constants";
import type { JobResult } from "@app/modules/jobs/job.types";
import { BunFileSystem } from "@effect/platform-bun";
import { createPlatformConfigFixture } from "@test/fixtures/platform.fixture";
import { TestImagePayload } from "@test/fixtures/test.constants";
import { Effect } from "effect";

/** Result returned by the streaming storage integration test. */
interface StorageTestResult {
  readonly metadata: JobResult;
  readonly text: string;
}

describe("result storage", (): void => {
  test("writes atomically and streams the same bytes", async (): Promise<void> => {
    const root: string = `/tmp/platform-storage-${crypto.randomUUID()}`;
    const config: PlatformConfig = createPlatformConfigFixture(root);
    const effect: Effect.Effect<StorageTestResult, StorageError> = Effect.gen(
      function* storageTestEffect() {
        const storage: ResultStorageShape = yield* ResultStorage;
        const metadata: JobResult = yield* storage.writeBase64(
          "job-storage-1",
          0,
          OutputFormat.png,
          TestImagePayload.hello,
        );
        const stored: StoredResult = yield* storage.read(metadata);
        const text: string = yield* Effect.promise(
          (): Promise<string> => new Response(stored.stream).text(),
        );
        return { metadata: stored.metadata, text };
      },
    ).pipe(
      Effect.provide(ResultStorage.Default),
      Effect.provideService(ConfigService, config),
      Effect.provide(BunFileSystem.layer),
    );
    const stored: StorageTestResult = await Effect.runPromise(effect);
    expect(stored.text).toBe("hello");
    expect(stored.metadata.sha256).toHaveLength(64);
  });

  test("removes a published result explicitly", async (): Promise<void> => {
    const root: string = `/tmp/platform-storage-${crypto.randomUUID()}`;
    const config: PlatformConfig = createPlatformConfigFixture(root);
    const effect: Effect.Effect<boolean, StorageError> = Effect.gen(
      function* removeStorageTestEffect() {
        const storage: ResultStorageShape = yield* ResultStorage;
        const metadata: JobResult = yield* storage.writeBase64(
          "job-storage-remove",
          0,
          OutputFormat.png,
          TestImagePayload.hello,
        );
        yield* storage.remove(metadata);
        return yield* storage.read(metadata).pipe(
          Effect.match({
            onFailure: (): boolean => true,
            onSuccess: (): boolean => false,
          }),
        );
      },
    ).pipe(
      Effect.provide(ResultStorage.Default),
      Effect.provideService(ConfigService, config),
      Effect.provide(BunFileSystem.layer),
    );
    expect(await Effect.runPromise(effect)).toBe(true);
  });
});
