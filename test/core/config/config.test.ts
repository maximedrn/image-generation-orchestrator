import { describe, expect, test } from "bun:test";
import {
  ConfigDefaults,
  ConfigEnvironment,
  EngineBackend,
  EngineProvider,
} from "@app/core/config/config.constants";
import {
  validateEngineUrl,
  validateModelAssignments,
  validateUniqueEngineIds,
} from "@app/core/config/config.helpers";
import { loadConfig } from "@app/core/config/config.service";
import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import type { ConfigError } from "@app/core/errors/error.types";
import { BunFileSystem } from "@effect/platform-bun";
import {
  createPlatformConfigFixture,
  getFirstEngineFixture,
} from "@test/fixtures/platform.fixture";
import { TestCaller } from "@test/fixtures/test.constants";
import { Effect, Exit } from "effect";

/** Environment values exercised by the overlay tests. */
const TestEnvironment = {
  apiKey: TestCaller.apiKeyVariable,
  backend: ConfigEnvironment.engineBackend,
  engineUrl: ConfigEnvironment.engineUrl,
  modelUrl: "MODEL__SD15",
  port: ConfigEnvironment.port,
} as const;

/** Value reused across this suite. */
const TestStorageRoot: string = "/tmp/config-test";

/** Test-only configuration secret that must never be logged. */
const TestApiKey: string = "resolved-secret";

/** Unsupported URL used to prove protocol validation is explicit. */
const UnsupportedEngineUrl: string = "ftp://127.0.0.1:8080";

/** Additional model name deliberately left unassigned to every engine. */
const UnassignedModel: string = "unassigned-model";

/**
 * Executes a validation effect and reports whether it failed as expected.
 *
 * @param {Effect.Effect<void, ConfigError>} effect - Validation effect.
 * @returns {Promise<boolean>} Whether the effect failed.
 */
const validationFails = async (
  effect: Effect.Effect<void, ConfigError>,
): Promise<boolean> => {
  const exit: Exit.Exit<void, ConfigError> =
    await Effect.runPromiseExit(effect);
  return Exit.isFailure(exit);
};

/**
 * Copies the shipped platform document to a disposable path.
 *
 * @returns {Promise<string>} Temporary configuration file path.
 */
const writeTemporaryConfig = async (): Promise<string> => {
  const path: string = `/tmp/platform-config-${crypto.randomUUID()}.yaml`;
  await Bun.write(path, await Bun.file(ConfigDefaults.path).text());
  return path;
};

describe("configuration loading", (): void => {
  test("decodes YAML and resolves the bearer secret from the environment", async (): Promise<void> => {
    const config: PlatformConfig = await Effect.runPromise(
      loadConfig(await writeTemporaryConfig(), {
        [TestEnvironment.apiKey]: TestApiKey,
      }).pipe(Effect.provide(BunFileSystem.layer)),
    );
    expect(config.security.apiKey).toBe(TestApiKey);
    expect(config.engines[0]?.provider).toBe(EngineProvider.stableDiffusionCpp);
  });

  test("fails when bearer authentication references a missing secret", async (): Promise<void> => {
    const exit: Exit.Exit<PlatformConfig, ConfigError> =
      await Effect.runPromiseExit(
        loadConfig(await writeTemporaryConfig(), {}).pipe(
          Effect.provide(BunFileSystem.layer),
        ),
      );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("applies the environment overlay on top of the YAML document", async (): Promise<void> => {
    const config: PlatformConfig = await Effect.runPromise(
      loadConfig(await writeTemporaryConfig(), {
        [TestEnvironment.apiKey]: TestApiKey,
        [TestEnvironment.backend]: EngineBackend.cuda,
        [TestEnvironment.engineUrl]: "http://127.0.0.1:9000",
        [TestEnvironment.port]: "8123",
      }).pipe(Effect.provide(BunFileSystem.layer)),
    );
    expect(config.server.port).toBe(8123);
    expect(config.engines[0]?.backend).toBe(EngineBackend.cuda);
    expect(config.engines[0]?.url).toBe("http://127.0.0.1:9000");
  });

  test("collects declared model downloads and derives their file names", async (): Promise<void> => {
    const config: PlatformConfig = await Effect.runPromise(
      loadConfig(await writeTemporaryConfig(), {
        [TestEnvironment.apiKey]: TestApiKey,
        [TestEnvironment.modelUrl]:
          "https://example.test/models/v1-5-pruned.safetensors",
      }).pipe(Effect.provide(BunFileSystem.layer)),
    );
    expect(config.modelSource.downloads).toHaveLength(1);
    expect(config.modelSource.downloads[0]?.name).toBe(
      "v1-5-pruned.safetensors",
    );
  });

  test("keeps the YAML values when the environment adds no override", async (): Promise<void> => {
    const config: PlatformConfig = await Effect.runPromise(
      loadConfig(await writeTemporaryConfig(), {
        [TestEnvironment.apiKey]: TestApiKey,
      }).pipe(Effect.provide(BunFileSystem.layer)),
    );
    expect(config.server.port).toBe(3000);
    expect(config.engines[0]?.backend).toBe(EngineBackend.cpu);
    expect(config.modelSource.downloads).toHaveLength(0);
  });
});

describe("configuration invariants", (): void => {
  test("rejects non HTTP engine endpoints", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(TestStorageRoot);
    const engine: EngineConfig = getFirstEngineFixture(config);
    const invalidEngine: EngineConfig = {
      ...engine,
      url: UnsupportedEngineUrl,
    };
    expect(await validationFails(validateEngineUrl(invalidEngine))).toBe(true);
  });

  test("rejects duplicate engine identifiers", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(TestStorageRoot);
    const engine: EngineConfig = getFirstEngineFixture(config);
    const duplicate: EngineConfig = {
      ...engine,
      url: "http://127.0.0.1:18081",
    };
    expect(
      await validationFails(validateUniqueEngineIds([engine, duplicate])),
    ).toBe(true);
  });

  test("rejects public models not assigned to any engine", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture(TestStorageRoot);
    const invalidConfig: PlatformConfig = {
      ...config,
      models: {
        ...config.models,
        [UnassignedModel]: { maxHeight: 512, maxWidth: 512 },
      },
    };
    expect(await validationFails(validateModelAssignments(invalidConfig))).toBe(
      true,
    );
  });
});
