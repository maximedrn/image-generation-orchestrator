import { Effect } from "effect";

import { ENGINE_URL_PROTOCOL } from "@app/config/config.constants.js";
import type { EngineConfig, PlatformConfig } from "@app/config/config.types.js";
import { ConfigError } from "@app/error/error.types.js";

/** Minimum number of configured inference engines required at startup. */
const MINIMUM_ENGINE_COUNT = 1;

/**
 * Validates that a configured engine endpoint is an absolute HTTP(S) URL.
 *
 * @param engine - (EngineConfig) Engine configuration to validate.
 * @returns (Effect.Effect<void, ConfigError>) Validation effect.
 */
const validateEngineUrl = (
  engine: EngineConfig,
): Effect.Effect<void, ConfigError> => {
  const parsedUrl: Effect.Effect<URL, ConfigError> = Effect.try({
    catch: (cause: unknown): ConfigError =>
      new ConfigError({
        cause,
        message: `engine ${engine.id} has an invalid absolute URL`,
      }),
    try: (): URL => new URL(engine.url),
  });
  return Effect.flatMap(
    parsedUrl,
    (url: URL): Effect.Effect<void, ConfigError> =>
      url.protocol === ENGINE_URL_PROTOCOL.HTTP ||
      url.protocol === ENGINE_URL_PROTOCOL.HTTPS
        ? Effect.void
        : Effect.fail(
            new ConfigError({
              message: `unsupported protocol ${url.protocol} for engine ${engine.id}`,
            }),
          ),
  );
};

/**
 * Ensures engine identifiers are unique to keep leases and metrics unambiguous.
 *
 * @param engines - (readonly EngineConfig[]) Configured engine instances.
 * @returns (Effect.Effect<void, ConfigError>) Validation effect.
 */
const validateUniqueEngineIds = (
  engines: readonly EngineConfig[],
): Effect.Effect<void, ConfigError> => {
  const ids: Set<string> = new Set<string>();
  return Effect.forEach(
    engines,
    (engine: EngineConfig): Effect.Effect<void, ConfigError> => {
      if (ids.has(engine.id)) {
        return Effect.fail(
          new ConfigError({ message: `duplicate engine id: ${engine.id}` }),
        );
      }
      ids.add(engine.id);
      return Effect.void;
    },
    { discard: true },
  );
};

/**
 * Ensures every registered public model can be scheduled on at least one engine.
 *
 * @param config - (PlatformConfig) Fully decoded platform configuration.
 * @returns (Effect.Effect<void, ConfigError>) Validation effect.
 */
const validateModelAssignments = (
  config: PlatformConfig,
): Effect.Effect<void, ConfigError> =>
  Effect.forEach(
    Object.keys(config.models),
    (model: string): Effect.Effect<void, ConfigError> => {
      const assigned: boolean = config.engines.some(
        (engine: EngineConfig): boolean => engine.models.includes(model),
      );
      return assigned
        ? Effect.void
        : Effect.fail(
            new ConfigError({
              message: `model ${model} is not assigned to any engine`,
            }),
          );
    },
    { discard: true },
  );

/**
 * Applies cross-field invariants that cannot be expressed by the structural schema.
 *
 * @param config - (PlatformConfig) Fully decoded platform configuration.
 * @returns (Effect.Effect<void, ConfigError>) Validation effect.
 */
const validatePlatformConfig = (
  config: PlatformConfig,
): Effect.Effect<void, ConfigError> => {
  if (config.engines.length < MINIMUM_ENGINE_COUNT) {
    return Effect.fail(
      new ConfigError({ message: "at least one inference engine is required" }),
    );
  }
  return Effect.gen(function* validatePlatformConfigEffect(): Generator<
    unknown,
    void
  > {
    yield* validateUniqueEngineIds(config.engines);
    yield* Effect.forEach(
      config.engines,
      (engine: EngineConfig): Effect.Effect<void, ConfigError> =>
        validateEngineUrl(engine),
      { concurrency: "unbounded", discard: true },
    );
    yield* validateModelAssignments(config);
  });
};

export {
  validateEngineUrl,
  validateModelAssignments,
  validatePlatformConfig,
  validateUniqueEngineIds,
};
