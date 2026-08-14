import { describe, expect, test } from "bun:test";
import { BunFileSystem } from "@effect/platform-bun";
import { Effect, Exit } from "effect";

import {
  validateEngineUrl,
  validateModelAssignments,
  validateUniqueEngineIds,
} from "@app/config/config.helpers.js";
import { loadConfig } from "@app/config/config.service.js";
import type { EngineConfig, PlatformConfig } from "@app/config/config.types.js";
import type { ConfigError } from "@app/error/error.types.js";
import {
  createPlatformConfigFixture,
  getFirstEngineFixture,
} from "@test/platform.fixture.js";

/** Environment key referenced by the example bearer configuration. */
const TEST_API_KEY_ENVIRONMENT_VARIABLE = "PLATFORM_API_KEY";

/** Test-only configuration secret that must never be logged. */
const TEST_API_KEY = "resolved-secret";

/** Unsupported URL used to prove protocol validation is explicit. */
const UNSUPPORTED_ENGINE_URL = "ftp://127.0.0.1:8080";

/** Additional model name deliberately left unassigned to every engine. */
const UNASSIGNED_MODEL = "unassigned-model";

/**
 * Executes a validation effect and reports whether it failed as expected.
 *
 * @param effect - (Effect.Effect<void, ConfigError>) Validation effect.
 * @returns (Promise<boolean>) Whether the effect failed.
 */
const validationFails = async (
  effect: Effect.Effect<void, ConfigError>,
): Promise<boolean> => {
  const exit: Exit.Exit<void, ConfigError> = await Effect.runPromiseExit(effect);
  return Exit.isFailure(exit);
};

describe("configuration loading", (): void => {
  test("decodes YAML and resolves the bearer secret from the environment", async (): Promise<void> => {
    const path: string = `/tmp/platform-config-${crypto.randomUUID()}.yaml`;
    const yaml: string = await Bun.file("config/platform.example.yaml").text();
    await Bun.write(path, yaml);
    const config: PlatformConfig = await Effect.runPromise(
      loadConfig(path, {
        [TEST_API_KEY_ENVIRONMENT_VARIABLE]: TEST_API_KEY,
      }).pipe(Effect.provide(BunFileSystem.layer)),
    );
    expect(config.security.apiKey).toBe(TEST_API_KEY);
    expect(config.engines[0]?.provider).toBe("stable-diffusion-cpp");
  });

  test("fails when bearer authentication references a missing secret", async (): Promise<void> => {
    const path: string = `/tmp/platform-config-${crypto.randomUUID()}.yaml`;
    const yaml: string = await Bun.file("config/platform.example.yaml").text();
    await Bun.write(path, yaml);
    const exit: Exit.Exit<PlatformConfig, ConfigError> = await Effect.runPromiseExit(
      loadConfig(path, {}).pipe(Effect.provide(BunFileSystem.layer)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });
});

describe("configuration invariants", (): void => {
  test("rejects non HTTP engine endpoints", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture("/tmp/config-test");
    const engine: EngineConfig = getFirstEngineFixture(config);
    const invalidEngine: EngineConfig = { ...engine, url: UNSUPPORTED_ENGINE_URL };
    expect(await validationFails(validateEngineUrl(invalidEngine))).toBe(true);
  });

  test("rejects duplicate engine identifiers", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture("/tmp/config-test");
    const engine: EngineConfig = getFirstEngineFixture(config);
    const duplicate: EngineConfig = { ...engine, url: "http://127.0.0.1:18081" };
    expect(await validationFails(validateUniqueEngineIds([engine, duplicate]))).toBe(
      true,
    );
  });

  test("rejects public models not assigned to any engine", async (): Promise<void> => {
    const config: PlatformConfig = createPlatformConfigFixture("/tmp/config-test");
    const invalidConfig: PlatformConfig = {
      ...config,
      models: {
        ...config.models,
        [UNASSIGNED_MODEL]: { maxHeight: 512, maxWidth: 512 },
      },
    };
    expect(await validationFails(validateModelAssignments(invalidConfig))).toBe(
      true,
    );
  });
});
