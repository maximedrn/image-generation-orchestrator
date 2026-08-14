/** Source directories governed by the architecture audit. */
const ARCHITECTURE_SOURCE_ROOTS: readonly string[] = ["src", "test", "scripts"];

/** Repository aliases accepted for non-relative TypeScript imports. */
const LOCAL_IMPORT_PREFIX = {
  APP: "@app/",
  SCRIPTS: "@scripts/",
  TEST: "@test/",
} as const;

/** Repository source root selected by each local import alias. */
const LOCAL_IMPORT_ROOT = {
  [LOCAL_IMPORT_PREFIX.APP]: "src/",
  [LOCAL_IMPORT_PREFIX.SCRIPTS]: "scripts/",
  [LOCAL_IMPORT_PREFIX.TEST]: "test/",
} as const;

/** Path fragment reserved to the stable-diffusion.cpp adapter boundary. */
const STABLE_DIFFUSION_ADAPTER_FRAGMENT = "/engine/stable-diffusion";

export {
  ARCHITECTURE_SOURCE_ROOTS,
  LOCAL_IMPORT_PREFIX,
  LOCAL_IMPORT_ROOT,
  STABLE_DIFFUSION_ADAPTER_FRAGMENT,
};
