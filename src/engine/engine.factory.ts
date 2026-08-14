import { Effect } from "effect";

import type {
  EngineConfig,
  EngineProvider,
} from "@app/config/config.types.js";
import type {
  EngineGatewayError,
  EngineGatewayShape,
} from "@app/engine/engine.interface.js";
import type {
  EngineCapabilities,
  EngineJob,
  EngineSubmission,
} from "@app/engine/engine.types.js";
import { EngineProtocolError } from "@app/error/error.types.js";
import type { JobCreateRequest } from "@app/job/job.types.js";

/** Registry of concrete inference adapters keyed by provider identifier. */
type EngineAdapterRegistry = Readonly<
  Partial<Record<EngineProvider, EngineGatewayShape>>
>;

/**
 * Resolves the concrete transport adapter registered for one engine instance.
 *
 * @param registry - (EngineAdapterRegistry) Provider-to-adapter registry.
 * @param engine - (EngineConfig) Target configured engine.
 * @returns (Effect.Effect<EngineGatewayShape, EngineProtocolError>) Concrete adapter.
 */
const resolveEngineAdapter = (
  registry: EngineAdapterRegistry,
  engine: EngineConfig,
): Effect.Effect<EngineGatewayShape, EngineProtocolError> => {
  const adapter: EngineGatewayShape | undefined = registry[engine.provider];
  return adapter === undefined
    ? Effect.fail(
        new EngineProtocolError({
          engineId: engine.id,
          message: `no engine adapter registered for provider ${engine.provider}`,
        }),
      )
    : Effect.succeed(adapter);
};

/**
 * Builds a provider router implementing the provider-neutral engine gateway port.
 *
 * @param registry - (EngineAdapterRegistry) Concrete provider adapters.
 * @returns (EngineGatewayShape) Provider-agnostic engine gateway.
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
        (adapter: EngineGatewayShape): Effect.Effect<EngineJob, EngineGatewayError> =>
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
        (adapter: EngineGatewayShape): Effect.Effect<EngineJob, EngineGatewayError> =>
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
