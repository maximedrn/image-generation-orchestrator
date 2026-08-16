import { afterEach, describe, expect, test } from "bun:test";
import { validatePlatformConfig } from "@app/core/config/config.helpers";
import { loadConfig } from "@app/core/config/config.service";
import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { ErrorTag } from "@app/core/errors/error.constants";
import type { ConfigError } from "@app/core/errors/error.types";
import { BunFileSystem } from "@effect/platform-bun";
import { createPlatformConfigFixture } from "@test/fixtures/platform.fixture";
import { TestCaller } from "@test/fixtures/test.constants";
import { Effect, Either, Option } from "effect";

/** Environment variable names driven by these tests. */
const EnvironmentName = {
  apiKey: TestCaller.apiKeyVariable,
} as const;

/** Temporary paths created by the running test. */
const TemporaryPaths: string[] = [];

/**
 * Builds the minimal environment overlay a configuration load requires.
 *
 * @returns {Record<string, string>} Environment map carrying the API key.
 */
const secretEnvironment = (): Record<string, string> => {
  const environment: Record<string, string> = {};
  environment[EnvironmentName.apiKey] = TestCaller.arbitrarySecret;
  return environment;
};

/**
 * Writes one throwaway file and remembers it for cleanup.
 *
 * @param {string} contents - File body.
 * @returns {Promise<string>} Absolute path of the written file.
 */
const writeTemporary = async (contents: string): Promise<string> => {
  const path: string = `/tmp/platform-cfg-${crypto.randomUUID()}.yaml`;
  await Bun.write(path, contents);
  TemporaryPaths.push(path);
  return path;
};

/**
 * Loads one configuration file, materializing the typed failure.
 *
 * @param {string} path - Configuration path.
 * @returns {Promise<Either.Either<PlatformConfig, ConfigError>>} Load outcome.
 */
const load = (
  path: string,
): Promise<Either.Either<PlatformConfig, ConfigError>> =>
  Effect.runPromise(
    Effect.either(loadConfig(path, secretEnvironment())).pipe(
      Effect.provide(BunFileSystem.layer),
    ),
  );

afterEach(async (): Promise<void> => {
  for (const path of TemporaryPaths.splice(0)) {
    await Bun.file(path)
      .delete()
      .catch((): void => undefined);
  }
});

describe("configuration loading failures", (): void => {
  test("reports an unreadable configuration file", async (): Promise<void> => {
    const outcome: Either.Either<PlatformConfig, ConfigError> = await load(
      "/tmp/definitely-absent-platform.yaml",
    );
    expect(Either.isLeft(outcome)).toBe(true);
    if (Either.isLeft(outcome)) {
      expect(outcome.left._tag).toBe(ErrorTag.config);
    }
  });

  test("reports a document that is not valid YAML", async (): Promise<void> => {
    const path: string = await writeTemporary("server: [unclosed\n");
    const outcome: Either.Either<PlatformConfig, ConfigError> =
      await load(path);
    expect(Either.isLeft(outcome)).toBe(true);
  });

  test("reports a YAML document violating the schema", async (): Promise<void> => {
    const path: string = await writeTemporary("server:\n  port: 3000\n");
    const outcome: Either.Either<PlatformConfig, ConfigError> =
      await load(path);
    expect(Either.isLeft(outcome)).toBe(true);
  });

  test("rejects an engine whose url is not parseable", async (): Promise<void> => {
    const base: PlatformConfig = createPlatformConfigFixture("/tmp/cfg-url");
    const outcome: Either.Either<void, ConfigError> = await Effect.runPromise(
      Effect.either(
        validatePlatformConfig({
          ...base,
          engines: base.engines.map(
            (engine: EngineConfig): EngineConfig => ({
              ...engine,
              url: "not a url at all",
            }),
          ),
        }),
      ),
    );
    expect(Either.isLeft(outcome)).toBe(true);
  });

  test("rejects an engine url whose protocol is not http", async (): Promise<void> => {
    const base: PlatformConfig = createPlatformConfigFixture("/tmp/cfg-proto");
    const outcome: Either.Either<void, ConfigError> = await Effect.runPromise(
      Effect.either(
        validatePlatformConfig({
          ...base,
          engines: base.engines.map(
            (engine: EngineConfig): EngineConfig => ({
              ...engine,
              url: "ftp://engine.invalid/generate",
            }),
          ),
        }),
      ),
    );
    expect(Either.isLeft(outcome)).toBe(true);
  });

  test("rejects a configuration declaring no engine at all", async (): Promise<void> => {
    const base: PlatformConfig = createPlatformConfigFixture("/tmp/cfg-empty");
    const outcome: Either.Either<void, ConfigError> = await Effect.runPromise(
      Effect.either(validatePlatformConfig({ ...base, engines: [] })),
    );
    expect(Either.isLeft(outcome)).toBe(true);
  });

  test("rejects a registered model no engine can schedule", async (): Promise<void> => {
    const base: PlatformConfig = createPlatformConfigFixture("/tmp/cfg-orphan");
    const outcome: Either.Either<void, ConfigError> = await Effect.runPromise(
      Effect.either(
        validatePlatformConfig({
          ...base,
          engines: base.engines.map(
            (engine: EngineConfig): EngineConfig => ({ ...engine, models: [] }),
          ),
        }),
      ),
    );
    expect(Either.isLeft(outcome)).toBe(true);
  });

  test("rejects two engines sharing one identifier", async (): Promise<void> => {
    const base: PlatformConfig = createPlatformConfigFixture("/tmp/cfg-dup");
    const engineOption: Option.Option<EngineConfig> = Option.fromNullable(
      base.engines[0],
    );
    if (Option.isNone(engineOption)) {
      throw new Error("fixture must declare an engine");
    }
    const engine: EngineConfig = engineOption.value;
    const outcome: Either.Either<void, ConfigError> = await Effect.runPromise(
      Effect.either(
        validatePlatformConfig({ ...base, engines: [engine, engine] }),
      ),
    );
    expect(Either.isLeft(outcome)).toBe(true);
  });
});
