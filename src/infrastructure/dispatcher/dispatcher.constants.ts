/** Stable internal failure codes persisted without leaking upstream bodies. */
const DispatcherErrorCode = {
  engine: "ENGINE_ERROR",
  remote: "REMOTE_GENERATION_FAILED",
  storage: "RESULT_STORAGE_FAILED",
} as const;

/** Stable durable messages persisted for platform-owned dispatcher failures. */
const DispatcherErrorMessage = {
  emptyResult: "completed engine job did not contain an image result",
  engineRetryExhausted: "inference engine unavailable after retry budget",
  remoteFailed: "remote generation failed",
  storageFailed: "completed output could not be persisted",
} as const;

/** Operator-facing dispatcher log messages. */
const DispatcherMessage = {
  incompleteRecoveryFailed: "incomplete job recovery failed",
  iterationFailed: "dispatcher iteration failed",
  leaseOwnershipLost: "recovery lease ownership was lost",
  pollingDeferred: "remote polling deferred to lease recovery",
  postSubmissionDeferred: "remote-bound worker deferred to lease recovery",
  recoveryDeferred: "remote job recovery deferred",
  recoveryFailed: "dispatcher recovery failed",
  remoteJobLost: "engine forgot the remote job, applying the retry policy",
  retryPersistenceFailed: "dispatcher retry persistence failed",
  submissionFailed: "engine submission failed",
  unboundCancellationFailed: "unbound remote job cancellation failed",
} as const;

/** Recovery scopes distinguishing process startup from periodic lease repair. */
const DispatcherRecoveryScope = {
  allRunning: "all-running",
  expiredOnly: "expired-only",
} as const;

export {
  DispatcherErrorCode,
  DispatcherErrorMessage,
  DispatcherMessage,
  DispatcherRecoveryScope,
};
