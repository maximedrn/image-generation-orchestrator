import {
  ConfigDefaults,
  ConfigEnvironment,
  ConfigMessage,
} from "@app/core/config/config.constants";
import { validatePlatformConfig } from "@app/core/config/config.helpers";
import { readConfigOverlay } from "@app/core/config/config.overlay";
import type { PlatformConfigFile } from "@app/core/config/config.schema";
import { PlatformConfigFileSchema } from "@app/core/config/config.schema";
import type {
  ConfigOverlay,
  EngineConfig,
  PlatformConfig,
} from "@app/core/config/config.types";
import { ConfigError } from "@app/core/errors/error.types";
import {
  PayloadEncoding,
  SchemaParseOption,
} from "@app/core/runtime/runtime.constants";
import { ServiceTag } from "@app/core/runtime/service.constants";
import { FileSystem } from "@effect/platform/FileSystem";
import { Context, Effect, Layer, Schema } from "effect";
import { parse as parseYaml } from "yaml";

/** Effect Context tag carrying the immutable resolved configuration. */
class ConfigService extends Context.Tag(ServiceTag.configService)<
  ConfigService,
  PlatformConfig
>() {}

/**
 * Applies the environment overlay to one configured engine.
 *
 * @param {EngineConfig} engine - Engine decoded from the YAML document.
 * @param {ConfigOverlay} overlay - Environment overrides.
 * @returns {EngineConfig} Engine with backend and URL overrides applied.
 */
const overlayEngine = (
  engine: EngineConfig,
  overlay: ConfigOverlay,
): EngineConfig => ({
  ...engine,
  backend: overlay.engineBackend ?? engine.backend,
  url: overlay.engineUrl ?? engine.url,
});

/**
 * Merges the decoded YAML document with its environment overlay.
 *
 * @param {PlatformConfigFile} decoded - Structurally validated YAML document.
 * @param {ConfigOverlay} overlay - Environment overrides.
 * @returns {PlatformConfig} Fully resolved immutable configuration.
 */
const mergeConfig = (
  decoded: PlatformConfigFile,
  overlay: ConfigOverlay,
): PlatformConfig => ({
  ...decoded,
  engines: decoded.engines.map(
    (engine: EngineConfig): EngineConfig => overlayEngine(engine, overlay),
  ),
  modelSource: {
    directory: overlay.modelDirectory,
    downloads: overlay.modelDownloads,
  },
  security: { apiKey: overlay.apiKey, auth: decoded.security.auth },
  server: { ...decoded.server, port: overlay.port ?? decoded.server.port },
});

/**
 * Reads and structurally decodes the YAML platform configuration document.
 *
 * @param {string} path - YAML file path.
 * @returns {Effect.Effect<PlatformConfigFile, ConfigError, FileSystem>} Decoded document.
 */
const readConfigFile = (
  path: string,
): Effect.Effect<PlatformConfigFile, ConfigError, FileSystem> =>
  FileSystem.pipe(
    Effect.flatMap(
      (fileSystem: FileSystem): Effect.Effect<string, ConfigError> =>
        fileSystem.readFileString(path, PayloadEncoding.utf8).pipe(
          Effect.mapError(
            (cause: unknown): ConfigError =>
              new ConfigError({
                cause,
                message: `${ConfigMessage.unreadableFile}: ${path}`,
              }),
          ),
        ),
    ),
    Effect.flatMap(
      (raw: string): Effect.Effect<unknown, ConfigError> =>
        Effect.try({
          catch: (cause: unknown): ConfigError =>
            new ConfigError({
              cause,
              message: `${ConfigMessage.invalidYaml}: ${path}`,
            }),
          try: (): unknown => parseYaml(raw),
        }),
    ),
    Effect.flatMap(
      (parsed: unknown): Effect.Effect<PlatformConfigFile, ConfigError> =>
        Schema.decodeUnknown(PlatformConfigFileSchema, {
          onExcessProperty: SchemaParseOption.rejectExcessProperty,
        })(parsed).pipe(
          Effect.mapError(
            (cause: unknown): ConfigError =>
              new ConfigError({
                cause,
                message: `${ConfigMessage.validationFailed}: ${path}`,
              }),
          ),
        ),
    ),
  );

/**
 * Loads, validates and resolves the complete platform configuration.
 *
 * @param {string} path - YAML file path.
 * @param {Readonly<Record<string, string | undefined>>} environment - Environment snapshot.
 * @returns {Effect.Effect<PlatformConfig, ConfigError, FileSystem>} Typed configuration.
 */
const loadConfig = (
  path: string,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<PlatformConfig, ConfigError, FileSystem> =>
  readConfigFile(path).pipe(
    Effect.flatMap(
      (
        decoded: PlatformConfigFile,
      ): Effect.Effect<PlatformConfig, ConfigError> =>
        readConfigOverlay(decoded, environment).pipe(
          Effect.map(
            (overlay: ConfigOverlay): PlatformConfig =>
              mergeConfig(decoded, overlay),
          ),
        ),
    ),
    Effect.tap(validatePlatformConfig),
  );

/** Live configuration layer backed by the Bun environment and Effect FileSystem. */
const ConfigServiceLive: Layer.Layer<ConfigService, ConfigError, FileSystem> =
  Layer.effect(
    ConfigService,
    Effect.suspend(
      (): Effect.Effect<PlatformConfig, ConfigError, FileSystem> =>
        loadConfig(
          Bun.env[ConfigEnvironment.configPath] ?? ConfigDefaults.path,
          Bun.env,
        ),
    ),
  );

export {
  ConfigService,
  ConfigServiceLive,
  loadConfig,
  mergeConfig,
  readConfigFile,
};
