import { afterEach, describe, expect, test } from "bun:test";
import { ConfigEnvironment } from "@app/core/config/config.constants";
import {
  ConfigService,
  ConfigServiceLive,
  loadConfig,
} from "@app/core/config/config.service";
import type { PlatformConfig } from "@app/core/config/config.types";
import type { ConfigError } from "@app/core/errors/error.types";
import { BunFileSystem } from "@effect/platform-bun";
import { TestCaller } from "@test/fixtures/test.constants";
import { Effect, Either, Layer } from "effect";

/** Environment variable names driven by these tests. */
const EnvironmentName = {
  apiKey: TestCaller.apiKeyVariable,
  modelDigest: "MODEL_SHA256__DEMO",
  modelUrl: "MODEL__DEMO",
} as const;

/** Minimal but complete YAML document accepted by the platform schema. */
const ValidConfigDocument: string = `
server:
  host: "127.0.0.1"
  port: 3000
  bodyLimitBytes: 1048576
security:
  auth: "bearer"
storage:
  root: "/tmp/platform-wiring"
queue:
  leaseSeconds: 120
  maxAttempts: 3
  maxQueuedJobs: 10
  maxRunningJobs: 1
  pollIntervalMs: 50
  recoveryIntervalSeconds: 5
rateLimit:
  maxRequests: 10
  maxTrackedClients: 100
  windowSeconds: 60
limits:
  maxBatch: 4
  maxHeight: 2048
  maxInputBytes: 65536
  maxJobCost: 134217728
  maxPixels: 4194304
  maxSteps: 80
  maxWidth: 2048
models:
  demo-model:
    maxHeight: 2048
    maxWidth: 2048
engines:
  - id: "engine-a"
    backend: "cpu"
    provider: "stable-diffusion-cpp"
    url: "http://127.0.0.1:18080"
    maxConcurrent: 1
    requestTimeoutSeconds: 1
    models: ["demo-model"]
    circuitBreaker:
      cooldownSeconds: 30
      failureThreshold: 3
`;

/** Temporary files created by the running test. */
const TemporaryPaths: string[] = [];

/**
 * Builds the environment overlay without literal screaming-snake keys.
 *
 * @returns {Record<string, string>} Environment map driving the overlay.
 */
const overlayEnvironment = (): Record<string, string> => {
  const environment: Record<string, string> = {};
  environment[EnvironmentName.apiKey] = "overlay-secret";
  environment[EnvironmentName.modelDigest] = "a".repeat(64);
  environment[EnvironmentName.modelUrl] =
    "https://example.invalid/demo.safetensors";
  return environment;
};

afterEach(async (): Promise<void> => {
  for (const path of TemporaryPaths.splice(0)) {
    await Bun.file(path)
      .delete()
      .catch((): void => undefined);
  }
});

describe("live configuration layer", (): void => {
  test("loads the document named by the environment", async (): Promise<void> => {
    const path: string = `/tmp/platform-wiring-${crypto.randomUUID()}.yaml`;
    await Bun.write(path, ValidConfigDocument);
    TemporaryPaths.push(path);
    const previousPath: string | undefined =
      Bun.env[ConfigEnvironment.configPath];
    const previousKey: string | undefined = Bun.env[EnvironmentName.apiKey];
    Bun.env[ConfigEnvironment.configPath] = path;
    Bun.env[EnvironmentName.apiKey] = "wiring-secret";
    const loaded: Either.Either<PlatformConfig, ConfigError> =
      await Effect.runPromise(
        Effect.either(
          ConfigService.pipe(
            Effect.provide(
              ConfigServiceLive.pipe(Layer.provide(BunFileSystem.layer)),
            ),
          ),
        ),
      );
    Bun.env[ConfigEnvironment.configPath] = previousPath;
    Bun.env[EnvironmentName.apiKey] = previousKey;
    expect(Either.isRight(loaded)).toBe(true);
    if (Either.isRight(loaded)) {
      expect(loaded.right.security.apiKey).toBe("wiring-secret");
      expect(loaded.right.engines).toHaveLength(1);
    }
  });

  test("attaches a declared digest to the matching model download", async (): Promise<void> => {
    const path: string = `/tmp/platform-wiring-${crypto.randomUUID()}.yaml`;
    await Bun.write(path, ValidConfigDocument);
    TemporaryPaths.push(path);
    const loaded: Either.Either<PlatformConfig, ConfigError> =
      await Effect.runPromise(
        Effect.either(loadConfig(path, overlayEnvironment())).pipe(
          Effect.provide(BunFileSystem.layer),
        ),
      );
    expect(Either.isRight(loaded)).toBe(true);
    if (Either.isRight(loaded)) {
      expect(loaded.right.modelSource.downloads).toHaveLength(1);
      expect(loaded.right.modelSource.downloads[0]?.sha256).toBe(
        "a".repeat(64),
      );
    }
  });
});
