/** Values the probe endpoints report, shared by the response types. */
const HealthStatus = {
  live: "live",
  ready: "ready",
} as const;

/** Operator-facing readiness failure message. */
const HealthMessage = {
  noUsableEngine: "no inference engine supports image generation",
} as const;

export { HealthMessage, HealthStatus };
