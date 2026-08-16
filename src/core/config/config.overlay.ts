import {
  AuthMode,
  ConfigDefaults,
  ConfigEnvironment,
  ConfigMessage,
  ConfigSchemaLimits,
  EngineBackend,
  EnvironmentSyntax,
  ModelEnvironmentPrefix,
} from "@app/core/config/config.constants";
import type { PlatformConfigFile } from "@app/core/config/config.schema";
import type {
  ConfigOverlay,
  EngineBackendValue,
  ModelDownload,
} from "@app/core/config/config.types";
import { ConfigError } from "@app/core/errors/error.types";
import {
  Config,
  ConfigProvider,
  Effect,
  HashMap,
  Option,
  Redacted,
} from "effect";

/**
 * Builds an Effect config provider over an explicit environment snapshot.
 *
 * The `__` path delimiter keeps single-underscore names such as
 * `MODEL__CONTROLNET_CANNY` inside one map entry instead of nesting them.
 *
 * @param {Readonly<Record<string, string | undefined>>} environment - Environment snapshot.
 * @returns {ConfigProvider.ConfigProvider} Provider reading the given snapshot.
 */
const createEnvironmentProvider = (
  environment: Readonly<Record<string, string | undefined>>,
): ConfigProvider.ConfigProvider =>
  ConfigProvider.fromMap(
    new Map<string, string>(
      Object.entries(environment).flatMap(
        ([key, value]: readonly [
          string,
          string | undefined,
        ]): readonly (readonly [string, string])[] =>
          Option.match(Option.fromNullable(value), {
            onNone: (): readonly (readonly [string, string])[] => [],
            onSome: (
              present: string,
            ): readonly (readonly [string, string])[] => [[key, present]],
          }),
      ),
    ),
    { pathDelim: EnvironmentSyntax.pathDelimiter },
  );

/**
 * Derives a stable local filename from a declared model URL.
 *
 * @param {string} url - Absolute model download URL.
 * @param {string} fallback - Declaration name used when the URL has no path segment.
 * @returns {string} Local file name written under the model directory.
 */
const modelFileName = (url: string, fallback: string): string =>
  Option.getOrElse(
    Option.fromNullable(
      new URL(url).pathname.split(EnvironmentSyntax.urlPathSeparator).at(-1),
    ).pipe(Option.filter((segment: string): boolean => segment.length > 0)),
    (): string => fallback,
  );

/**
 * Reads every `MODEL__<name>` declaration and its optional integrity digest.
 *
 * @returns {Config.Config<readonly ModelDownload[]>} Declared model artefacts.
 */
const modelDownloadsConfig: Config.Config<readonly ModelDownload[]> =
  Config.all([
    Config.hashMap(Config.string(), ModelEnvironmentPrefix.url),
    Config.hashMap(Config.string(), ModelEnvironmentPrefix.digest),
  ]).pipe(
    Config.map(
      ([urls, digests]: readonly [
        HashMap.HashMap<string, string>,
        HashMap.HashMap<string, string>,
      ]): readonly ModelDownload[] =>
        [...HashMap.entries(urls)].map(
          ([name, url]: readonly [string, string]): ModelDownload => ({
            name: modelFileName(url, name),
            ...Option.match(HashMap.get(digests, name), {
              onNone: (): Record<string, never> => ({}),
              onSome: (sha256: string): { readonly sha256: string } => ({
                sha256,
              }),
            }),
            url,
          }),
        ),
    ),
  );

/** Optional listener port override. */
const portConfig: Config.Config<Option.Option<number>> = Config.option(
  Config.integer(ConfigEnvironment.port).pipe(
    Config.validate({
      message: ConfigMessage.validationFailed,
      validation: (port: number): boolean =>
        port >= ConfigSchemaLimits.httpPortMin &&
        port <= ConfigSchemaLimits.httpPortMax,
    }),
  ),
);

/** Optional hardware backend override selecting the engine profile. */
const backendConfig: Config.Config<Option.Option<EngineBackendValue>> =
  Config.option(
    Config.literal(
      EngineBackend.cpu,
      EngineBackend.cuda,
      EngineBackend.metal,
      EngineBackend.rocm,
      EngineBackend.vulkan,
    )(ConfigEnvironment.engineBackend),
  );

/**
 * Reads the bearer secret, which is required only when bearer auth is enabled.
 *
 * @param {PlatformConfigFile} decoded - Structurally validated YAML document.
 * @returns {Config.Config<string>} Resolved API key, empty when auth is disabled.
 */
const apiKeyConfig = (decoded: PlatformConfigFile): Config.Config<string> =>
  decoded.security.auth === AuthMode.none
    ? Config.succeed("")
    : Config.redacted(ConfigEnvironment.apiKey).pipe(
        Config.map(Redacted.value),
        Config.validate({
          message: ConfigMessage.missingApiKey,
          validation: (apiKey: string): boolean => apiKey.length > 0,
        }),
      );

/**
 * Reads every environment override applied on top of the YAML document.
 *
 * @param {PlatformConfigFile} decoded - Structurally validated YAML document.
 * @param {Readonly<Record<string, string | undefined>>} environment - Environment snapshot.
 * @returns {Effect.Effect<ConfigOverlay, ConfigError>} Typed environment overlay.
 */
const readConfigOverlay = (
  decoded: PlatformConfigFile,
  environment: Readonly<Record<string, string | undefined>>,
): Effect.Effect<ConfigOverlay, ConfigError> =>
  Config.all([
    apiKeyConfig(decoded),
    backendConfig,
    Config.option(Config.string(ConfigEnvironment.engineUrl)),
    Config.string(ConfigEnvironment.modelDirectory).pipe(
      Config.withDefault(ConfigDefaults.modelDirectory),
    ),
    modelDownloadsConfig,
    portConfig,
  ]).pipe(
    Effect.map(
      ([
        apiKey,
        engineBackend,
        engineUrl,
        modelDirectory,
        modelDownloads,
        port,
      ]): ConfigOverlay => ({
        apiKey,
        ...Option.match(engineBackend, {
          onNone: (): Record<string, never> => ({}),
          onSome: (
            backend: EngineBackendValue,
          ): { readonly engineBackend: EngineBackendValue } => ({
            engineBackend: backend,
          }),
        }),
        ...Option.match(engineUrl, {
          onNone: (): Record<string, never> => ({}),
          onSome: (url: string): { readonly engineUrl: string } => ({
            engineUrl: url,
          }),
        }),
        modelDirectory,
        modelDownloads,
        ...Option.match(port, {
          onNone: (): Record<string, never> => ({}),
          onSome: (value: number): { readonly port: number } => ({
            port: value,
          }),
        }),
      }),
    ),
    Effect.withConfigProvider(createEnvironmentProvider(environment)),
    Effect.mapError(
      (cause: unknown): ConfigError =>
        new ConfigError({ cause, message: ConfigMessage.validationFailed }),
    ),
  );

export { createEnvironmentProvider, modelFileName, readConfigOverlay };
