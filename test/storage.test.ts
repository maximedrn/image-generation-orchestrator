import { describe, expect, test } from "bun:test";
import { BunFileSystem } from "@effect/platform-bun";
import { Effect } from "effect";

import type { PlatformConfig } from "@app/config/config.types.js";
import { ConfigService } from "@app/config/config.service.js";
import type { StorageError } from "@app/error/error.types.js";
import { OUTPUT_FORMAT } from "@app/job/job.constants.js";
import type { JobResult } from "@app/job/job.types.js";
import type {
  ResultStorageShape,
  StoredResult,
} from "@app/storage/storage.interface.js";
import {
  ResultStorage,
  ResultStorageLive,
} from "@app/storage/storage.service.js";
import { createPlatformConfigFixture } from "@test/platform.fixture.js";

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
      function* storageTestEffect(): Generator<unknown, StorageTestResult> {
        const storage: ResultStorageShape = yield* ResultStorage;
        const metadata: JobResult = yield* storage.writeBase64(
          "job-storage-1",
          0,
          OUTPUT_FORMAT.PNG,
          "aGVsbG8=",
        );
        const stored: StoredResult = yield* storage.read(metadata);
        const text: string = yield* Effect.promise((): Promise<string> =>
          new Response(stored.stream).text(),
        );
        return { metadata: stored.metadata, text };
      },
    ).pipe(
      Effect.provide(ResultStorageLive),
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
      function* removeStorageTestEffect(): Generator<unknown, boolean> {
        const storage: ResultStorageShape = yield* ResultStorage;
        const metadata: JobResult = yield* storage.writeBase64(
          "job-storage-remove",
          0,
          OUTPUT_FORMAT.PNG,
          "aGVsbG8=",
        );
        yield* storage.remove(metadata);
        return yield* storage.read(metadata).pipe(
          Effect.match({ onFailure: (): boolean => true, onSuccess: (): boolean => false }),
        );
      },
    ).pipe(
      Effect.provide(ResultStorageLive),
      Effect.provideService(ConfigService, config),
      Effect.provide(BunFileSystem.layer),
    );
    expect(await Effect.runPromise(effect)).toBe(true);
  });
});
