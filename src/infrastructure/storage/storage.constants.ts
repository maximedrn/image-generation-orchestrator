/** Operator-facing storage failure messages, prefixed to the offending path. */
const StorageMessage = {
  accessFailed: "cannot access result",
  createDirectoryFailed: "cannot create result directory",
  missingFile: "result file is missing",
  publishFailed: "cannot publish result",
  removeFailed: "cannot remove result",
  streamFailed: "cannot stream result",
  writeFailed: "cannot write temporary result",
} as const;

/** Layout of the result tree written under the configured storage root. */
const StorageLayout = {
  extensionSeparator: ".",
  messageSeparator: ": ",
  pathSeparator: "/",
  resultsDirectory: "results",
  temporarySuffix: ".tmp",
} as const;

export { StorageLayout, StorageMessage };
