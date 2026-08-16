/** Bounds applied while fetching declared model artefacts. */
const ModelDownloadPolicy = {
  concurrency: 2,
  expectedStatus: 200,
  temporarySuffix: ".partial",
} as const;

/** Operator-facing model-download messages. */
const ModelDownloadMessage = {
  digestMismatch: "downloaded model does not match the declared sha256 digest",
  downloading: "downloading model",
  publishFailed: "cannot publish downloaded model",
  rejected: "model download rejected with HTTP",
  requestFailed: "model download request failed",
  skipped: "model already present, skipping download",
  unreadableDirectory: "cannot create the model directory",
  writeFailed: "cannot write the downloaded model",
} as const;

export { ModelDownloadMessage, ModelDownloadPolicy };
