import type {
  EngineConfig,
  EngineProviderValue,
} from "@app/core/config/config.types";
import { EngineProtocolError } from "@app/core/errors/error.types";
import { EngineMessage } from "@app/infrastructure/engine/engine.constants";
import type {
  EngineGatewayError,
  EngineGatewayShape,
} from "@app/infrastructure/engine/engine.interface";
import type {
  EngineCapabilities,
  EngineJob,
  EngineSubmission,
} from "@app/infrastructure/engine/engine.types";
import type { JobCreateRequest } from "@app/modules/jobs/job.types";
import { Effect, Option } from "effect";

/** Registry of concrete inference adapters keyed by provider identifier. */
type EngineAdapterRegistry = Readonly<
  Partial<Record<EngineProviderValue, EngineGatewayShape>>
>;

/**
 * Resolves the concrete transport adapter registered for one engine instance.
 *
 * @param {EngineAdapterRegistry} registry - Provider-to-adapter registry.
 * @param {EngineConfig} engine - Target configured engine.
 * @returns {Effect.Effect<EngineGatewayShape, EngineProtocolError>} Concrete adapter.
 */
const resolveEngineAdapter = (
  registry: EngineAdapterRegistry,
  engine: EngineConfig,
): Effect.Effect<EngineGatewayShape, EngineProtocolError> =>
  Option.match(Option.fromNullable(registry[engine.provider]), {
    onNone: (): Effect.Effect<EngineGatewayShape, EngineProtocolError> =>
      Effect.fail(
        new EngineProtocolError({
          engineId: engine.id,
          message: `${EngineMessage.noAdapter}: ${engine.provider}`,
        }),
      ),
    onSome: (
      adapter: EngineGatewayShape,
    ): Effect.Effect<EngineGatewayShape, EngineProtocolError> =>
      Effect.succeed(adapter),
  });

/**
 * Builds a provider router implementing the provider-neutral engine gateway port.
 *
 * @param {EngineAdapterRegistry} registry - Concrete provider adapters.
 * @returns {EngineGatewayShape} Provider-agnostic engine gateway.
 */
const createEngineGatewayRouter = (
  registry: EngineAdapterRegistry,
): EngineGatewayShape => ({
  cancel: (
    engine: EngineConfig,
    remoteJobId: string,
  ): Effect.Effect<EngineJob, EngineGatewayError> =>
    resolveEngineAdapter(registry, engine).pipe(
      Effect.flatMap(
        (
          adapter: EngineGatewayShape,
        ): Effect.Effect<EngineJob, EngineGatewayError> =>
          adapter.cancel(engine, remoteJobId),
      ),
    ),
  capabilities: (
    engine: EngineConfig,
  ): Effect.Effect<EngineCapabilities, EngineGatewayError> =>
    resolveEngineAdapter(registry, engine).pipe(
      Effect.flatMap(
        (
          adapter: EngineGatewayShape,
        ): Effect.Effect<EngineCapabilities, EngineGatewayError> =>
          adapter.capabilities(engine),
      ),
    ),
  poll: (
    engine: EngineConfig,
    remoteJobId: string,
  ): Effect.Effect<EngineJob, EngineGatewayError> =>
    resolveEngineAdapter(registry, engine).pipe(
      Effect.flatMap(
        (
          adapter: EngineGatewayShape,
        ): Effect.Effect<EngineJob, EngineGatewayError> =>
          adapter.poll(engine, remoteJobId),
      ),
    ),
  submit: (
    engine: EngineConfig,
    request: JobCreateRequest,
  ): Effect.Effect<EngineSubmission, EngineGatewayError> =>
    resolveEngineAdapter(registry, engine).pipe(
      Effect.flatMap(
        (
          adapter: EngineGatewayShape,
        ): Effect.Effect<EngineSubmission, EngineGatewayError> =>
          adapter.submit(engine, request),
      ),
    ),
});

export type { EngineAdapterRegistry };
export { createEngineGatewayRouter, resolveEngineAdapter };
