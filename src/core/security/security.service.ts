import { AuthMode } from "@app/core/config/config.constants";
import { ConfigService } from "@app/core/config/config.service";
import type {
  PlatformConfig,
  SecurityConfig,
} from "@app/core/config/config.types";
import { UnauthorizedError } from "@app/core/errors/error.types";
import { ServiceTag } from "@app/core/runtime/service.constants";
import {
  BearerAuth,
  SecretDigest,
  SecurityMessage,
} from "@app/core/security/security.constants";
import type { SecurityServiceShape } from "@app/core/security/security.interface";
import { Effect, Option } from "effect";

/**
 * Hashes a secret before comparison so both operands have a fixed length.
 *
 * @param {string} value - Secret value.
 * @returns {string} SHA-256 hexadecimal digest.
 */
const hashSecret = (value: string): string =>
  new Bun.CryptoHasher(SecretDigest.algorithm)
    .update(value)
    .digest(SecretDigest.encoding);

/**
 * Compares two secrets without data-dependent early return.
 *
 * @param {string} left - First secret.
 * @param {string} right - Second secret.
 * @returns {boolean} Whether the fixed-length digests are identical.
 */
const constantTimeSecretEquals = (left: string, right: string): boolean => {
  const leftHash: string = hashSecret(left);
  const rightHash: string = hashSecret(right);
  let difference: number = 0;
  for (let index = 0; index < SecretDigest.hexLength; index += 1) {
    difference += Number(
      leftHash.charCodeAt(index) !== rightHash.charCodeAt(index),
    );
  }
  return difference === 0;
};

/**
 * Extracts a bearer token without accepting alternative schemes.
 *
 * @param {string | undefined} header - Authorization header value.
 * @returns {Option.Option<string>} Bearer token when the syntax is valid.
 */
const extractBearerToken = (
  header: string | undefined,
): Option.Option<string> =>
  Option.fromNullable(header).pipe(
    Option.filter((value: string): boolean =>
      value.startsWith(BearerAuth.prefix),
    ),
    Option.map((value: string): string =>
      value.slice(BearerAuth.prefix.length),
    ),
  );

/**
 * Builds authentication policy from the resolved security configuration.
 *
 * @param {SecurityConfig} config - Resolved auth mode and in-memory key.
 * @returns {SecurityServiceShape} Authentication service.
 */
const createSecurityService = (
  config: SecurityConfig,
): SecurityServiceShape => ({
  authorize: (
    authorizationHeader: string | undefined,
  ): Effect.Effect<void, UnauthorizedError> =>
    config.auth === AuthMode.none
      ? Effect.void
      : Option.match(extractBearerToken(authorizationHeader), {
          onNone: (): Effect.Effect<void, UnauthorizedError> =>
            Effect.fail(
              new UnauthorizedError({
                message: SecurityMessage.invalidCredentials,
              }),
            ),
          onSome: (
            candidate: string,
          ): Effect.Effect<void, UnauthorizedError> =>
            constantTimeSecretEquals(candidate, config.apiKey)
              ? Effect.void
              : Effect.fail(
                  new UnauthorizedError({
                    message: SecurityMessage.invalidCredentials,
                  }),
                ),
        }),
});

/** HTTP authentication policy resolved once from configuration. */
class SecurityService extends Effect.Service<SecurityService>()(
  ServiceTag.securityService,
  {
    effect: ConfigService.pipe(
      Effect.map(
        (config: PlatformConfig): SecurityServiceShape =>
          createSecurityService(config.security),
      ),
    ),
  },
) {}

export {
  constantTimeSecretEquals,
  createSecurityService,
  extractBearerToken,
  SecurityService,
};
