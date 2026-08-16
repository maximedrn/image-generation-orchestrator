/** Authorization schemes the platform recognises or a caller may present. */
const AuthScheme = {
  basic: "Basic",
  bearer: "Bearer",
} as const;

/** Separator between an authorization scheme and its credentials. */
const AuthSchemeSeparator: string = " ";

/** Bearer authentication vocabulary shared by the guard and the service. */
const BearerAuth = {
  header: "authorization",
  prefix: `${AuthScheme.bearer}${AuthSchemeSeparator}`,
} as const;

/** Digest properties used by the constant-time secret comparison. */
const SecretDigest = {
  algorithm: "sha256",
  encoding: "hex",
  hexLength: 64,
} as const;

/** Digest properties used to fingerprint stored and downloaded content. */
const ContentDigest = {
  algorithm: "sha256",
  encoding: "hex",
} as const;

/** Safe caller-facing authentication failure messages. */
const SecurityMessage = {
  invalidCredentials: "invalid bearer credentials",
} as const;

/** Local overload-protection messages and bounds. */
const RateLimitPolicy = {
  minimumRetryAfterSeconds: 1,
  rejectedMessage: "too many requests",
} as const;

export {
  AuthScheme,
  AuthSchemeSeparator,
  BearerAuth,
  ContentDigest,
  RateLimitPolicy,
  SecretDigest,
  SecurityMessage,
};
