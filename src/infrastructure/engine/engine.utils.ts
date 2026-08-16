import { ErrorTag } from "@app/core/errors/error.constants";
import type { PlatformError } from "@app/core/errors/error.types";
import type { EngineGatewayError } from "@app/infrastructure/engine/engine.interface";

/** Engine transport error tags used to isolate circuit-breaker failures. */
const EngineGatewayErrorTags: ReadonlySet<string> = new Set<string>([
  ErrorTag.engineProtocol,
  ErrorTag.engineRejected,
  ErrorTag.engineUnavailable,
]);

/**
 * Narrows an application error to the engine-gateway error family.
 *
 * @param {PlatformError} error - Typed application error.
 * @returns {boolean} `true` when the error came from an inference transport.
 */
const isEngineGatewayError = (
  error: PlatformError,
): error is EngineGatewayError => EngineGatewayErrorTags.has(error._tag);

export { EngineGatewayErrorTags, isEngineGatewayError };
