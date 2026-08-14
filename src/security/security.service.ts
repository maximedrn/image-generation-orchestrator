import { Context, Effect, Layer } from "effect";

import { EFFECT_SERVICE_IDENTIFIER } from "@app/runtime/runtime.constants.js";
import { AUTH_MODE } from "@app/config/config.constants.js";
import { ConfigService } from "@app/config/config.service.js";
import type { PlatformConfig, SecurityConfig } from "@app/config/config.types.js";
import { UnauthorizedError } from "@app/error/error.types.js";
import {
  BEARER_PREFIX,
  SHA256_HEX_LENGTH,
} from "@app/security/security.constants.js";
import type { SecurityServiceShape } from "@app/security/security.interface.js";

/** Effect Context tag for HTTP authentication policy. */
class SecurityService extends Context.Tag(EFFECT_SERVICE_IDENTIFIER.SECURITY)<
  SecurityService,
  SecurityServiceShape
>() {}

/**
 * Hashes a secret before comparison so both operands have a fixed length.
 *
 * @param value - (string) Secret value.
 * @returns (string) SHA-256 hexadecimal digest.
 */
const hashSecret = (value: string): string =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex");

/**
 * Compares two secrets without data-dependent early return.
 *
 * @param left - (string) First secret.
 * @param right - (string) Second secret.
 * @returns (boolean) Whether the fixed-length digests are identical.
 */
const constantTimeSecretEquals = (left: string, right: string): boolean => {
  const leftHash: string = hashSecret(left);
  const rightHash: string = hashSecret(right);
  let difference: number = 0;
  for (let index: number = 0; index < SHA256_HEX_LENGTH; index += 1) {
    difference |= leftHash.charCodeAt(index) ^ rightHash.charCodeAt(index);
  }
  return difference === 0;
};

/**
 * Extracts a bearer token without accepting alternative schemes.
 *
 * @param header - (string | undefined) Authorization header value.
 * @returns (string | undefined) Bearer token when syntax is valid.
 */
const extractBearerToken = (header: string | undefined): string | undefined =>
  header?.startsWith(BEARER_PREFIX) === true
    ? header.slice(BEARER_PREFIX.length)
    : undefined;

/**
 * Builds authentication policy from the resolved security configuration.
 *
 * @param config - (SecurityConfig) Resolved auth mode and in-memory key.
 * @returns (SecurityServiceShape) Authentication service.
 */
const createSecurityService = (config: SecurityConfig): SecurityServiceShape => ({
  authorize: (
    authorizationHeader: string | undefined,
  ): Effect.Effect<void, UnauthorizedError> => {
    if (config.auth === AUTH_MODE.NONE) {
      return Effect.void;
    }
    const candidate: string | undefined = extractBearerToken(
      authorizationHeader,
    );
    if (
      candidate === undefined ||
      !constantTimeSecretEquals(candidate, config.apiKey)
    ) {
      return Effect.fail(
        new UnauthorizedError({ message: "invalid bearer credentials" }),
      );
    }
    return Effect.void;
  },
});

/** Live authentication layer. */
const SecurityServiceLive: Layer.Layer<
  SecurityService,
  never,
  ConfigService
> = Layer.effect(
  SecurityService,
  Effect.gen(function* securityLayerEffect(): Generator<unknown, SecurityServiceShape> {
    const config: PlatformConfig = yield* ConfigService;
    return createSecurityService(config.security);
  }),
);

export {
  constantTimeSecretEquals,
  createSecurityService,
  extractBearerToken,
  SecurityService,
  SecurityServiceLive,
};
