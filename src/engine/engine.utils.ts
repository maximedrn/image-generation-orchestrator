import type { EngineGatewayError } from "@app/engine/engine.interface.js";
import type { PlatformError } from "@app/error/error.types.js";

/** Engine transport error tags used to isolate circuit-breaker failures. */
const ENGINE_GATEWAY_ERROR_TAGS: ReadonlySet<string> = new Set<string>([
  "EngineProtocolError",
  "EngineRejectedError",
  "EngineUnavailableError",
]);

/**
 * Narrows an application error to the engine-gateway error family.
 *
 * @param error - (PlatformError) Typed application error.
 * @returns (boolean) `true` when the error came from an inference transport.
 */
const isEngineGatewayError = (
  error: PlatformError,
): error is EngineGatewayError => ENGINE_GATEWAY_ERROR_TAGS.has(error._tag);

export { ENGINE_GATEWAY_ERROR_TAGS, isEngineGatewayError };
