/** NestJS dependency-injection tokens bridging Nest and the Effect runtime. */
const RuntimeToken = {
  effectRuntime: Symbol.for("stable-diffusion-platform/effect-runtime"),
} as const;

/** Process signals handled by the NestJS shutdown hooks. */
const ShutdownSignal = {
  interrupt: "SIGINT",
  terminate: "SIGTERM",
} as const;

/** Effect option values spelled once instead of at every call site. */
const EffectConcurrency = {
  unbounded: "unbounded",
} as const;

/** Schema decoding options applied at every trust boundary. */
const SchemaParseOption = {
  rejectExcessProperty: "error",
} as const;

/** Text and binary encodings used when reading or hashing payloads. */
const PayloadEncoding = {
  base64: "base64",
  utf8: "utf8",
} as const;

export {
  EffectConcurrency,
  PayloadEncoding,
  RuntimeToken,
  SchemaParseOption,
  ShutdownSignal,
};
