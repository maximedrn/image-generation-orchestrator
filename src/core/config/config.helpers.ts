import {
  ConfigInvariants,
  ConfigMessage,
  EngineUrlProtocol,
} from "@app/core/config/config.constants";
import type {
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { ConfigError } from "@app/core/errors/error.types";
import { EffectConcurrency } from "@app/core/runtime/runtime.constants";
import { Effect } from "effect";

/**
 * Validates that a configured engine endpoint is an absolute HTTP(S) URL.
 *
 * @param {EngineConfig} engine - Engine configuration to validate.
 * @returns {Effect.Effect<void, ConfigError>} Validation effect.
 */
const validateEngineUrl = (
  engine: EngineConfig,
): Effect.Effect<void, ConfigError> =>
  Effect.try({
    catch: (cause: unknown): ConfigError =>
      new ConfigError({
        cause,
        message: `${ConfigMessage.invalidEngineUrl}: ${engine.id}`,
      }),
    try: (): URL => new URL(engine.url),
  }).pipe(
    Effect.flatMap(
      (url: URL): Effect.Effect<void, ConfigError> =>
        url.protocol === EngineUrlProtocol.http ||
        url.protocol === EngineUrlProtocol.https
          ? Effect.void
          : Effect.fail(
              new ConfigError({
                message: `${ConfigMessage.unsupportedProtocol} ${engine.id}: ${url.protocol}`,
              }),
            ),
    ),
  );

/**
 * Ensures engine identifiers are unique to keep leases and metrics unambiguous.
 *
 * @param {readonly EngineConfig[]} engines - Configured engine instances.
 * @returns {Effect.Effect<void, ConfigError>} Validation effect.
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
          new ConfigError({
            message: `${ConfigMessage.duplicateEngineId}: ${engine.id}`,
          }),
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
 * @param {PlatformConfig} config - Fully decoded platform configuration.
 * @returns {Effect.Effect<void, ConfigError>} Validation effect.
 */
const validateModelAssignments = (
  config: PlatformConfig,
): Effect.Effect<void, ConfigError> =>
  Effect.forEach(
    Object.keys(config.models),
    (model: string): Effect.Effect<void, ConfigError> =>
      config.engines.some((engine: EngineConfig): boolean =>
        engine.models.includes(model),
      )
        ? Effect.void
        : Effect.fail(
            new ConfigError({
              message: `${ConfigMessage.engineNotAssigned}: ${model}`,
            }),
          ),
    { discard: true },
  );

/**
 * Applies cross-field invariants that cannot be expressed by the structural schema.
 *
 * @param {PlatformConfig} config - Fully decoded platform configuration.
 * @returns {Effect.Effect<void, ConfigError>} Validation effect.
 */
const validatePlatformConfig = (
  config: PlatformConfig,
): Effect.Effect<void, ConfigError> => {
  if (config.engines.length < ConfigInvariants.minimumEngineCount) {
    return Effect.fail(new ConfigError({ message: ConfigMessage.noEngine }));
  }
  return Effect.all(
    [
      validateUniqueEngineIds(config.engines),
      Effect.forEach(config.engines, validateEngineUrl, {
        concurrency: EffectConcurrency.unbounded,
        discard: true,
      }),
      validateModelAssignments(config),
    ],
    { discard: true },
  );
};

export {
  validateEngineUrl,
  validateModelAssignments,
  validatePlatformConfig,
  validateUniqueEngineIds,
};
