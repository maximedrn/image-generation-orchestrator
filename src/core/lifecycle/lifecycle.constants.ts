/**
 * Single source for the state words several vocabularies happen to share.
 *
 * `JobStatus`, `EngineJobStatus` and `StableDiffusionJobStatus` stay separate
 * objects on purpose: the public contract, the provider-neutral port and the
 * native protocol must be free to diverge. Only the spelling of the words is
 * shared, so renaming one state cannot silently reinterpret another layer.
 */
const LifecycleState = {
  cancelled: "cancelled",
  completed: "completed",
  failed: "failed",
  generating: "generating",
  queued: "queued",
  running: "running",
  succeeded: "succeeded",
} as const;

export { LifecycleState };
