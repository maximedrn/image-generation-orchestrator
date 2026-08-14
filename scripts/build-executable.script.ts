/** Supported Bun MUSL compilation targets by process architecture. */
const MUSL_TARGET_BY_ARCHITECTURE = {
  arm64: "bun-linux-arm64-musl",
  x64: "bun-linux-x64-musl-baseline",
} as const;

/** Optional NestJS integrations intentionally excluded from this HTTP-only binary. */
const OPTIONAL_RUNTIME_DEPENDENCIES = [
  "@fastify/cors",
  "@fastify/middie",
  "@fastify/static",
  "@fastify/view",
  "@nestjs/microservices",
  "@nestjs/platform-express",
  "@nestjs/platform-socket.io",
  "@nestjs/websockets",
  "body-parser",
  "class-transformer",
  "class-validator",
  "express",
] as const;

/** Name of the compiled release binary. */
const EXECUTABLE_OUTPUT_PATH = "dist/stable-diffusion-platform";

/** Entry point compiled into the release binary. */
const EXECUTABLE_ENTRY_POINT = "src/main.ts";

/** Environment variable allowing CI to override Bun's MUSL target explicitly. */
const MUSL_TARGET_ENVIRONMENT_VARIABLE = "BUN_MUSL_TARGET";

/** Environment variable allowing cross-build architecture selection. */
const PROCESS_ARCHITECTURE_ENVIRONMENT_VARIABLE = "PROCESS_ARCH";

/** Empty stderr fallback used when Bun does not emit diagnostic text. */
const EMPTY_PROCESS_OUTPUT: string = "";

/**
 * Resolves the current host architecture to a supported Bun MUSL target.
 *
 * @param architecture - (string) Bun process architecture identifier.
 * @param explicitTarget - (string | undefined) Optional operator-provided Bun target.
 * @returns (string) Bun compile target.
 */
const resolveMuslTarget = (
  architecture: string,
  explicitTarget?: string,
): string => {
  if (explicitTarget !== undefined && explicitTarget.length > 0) {
    return explicitTarget;
  }
  if (architecture === "arm64" || architecture === "x64") {
    return MUSL_TARGET_BY_ARCHITECTURE[architecture];
  }
  throw new Error(`unsupported MUSL build architecture: ${architecture}`);
};

/**
 * Converts intentionally external runtime packages into Bun CLI arguments.
 *
 * @param dependencies - (readonly string[]) Package names to leave external.
 * @returns (readonly string[]) Bun CLI arguments.
 */
const createExternalArguments = (
  dependencies: readonly string[],
): readonly string[] =>
  dependencies.flatMap(
    (dependency: string): readonly string[] => ["--external", dependency],
  );

/**
 * Compiles the NestJS/Effect application into one Bun MUSL executable.
 *
 * @returns (void) Throws when Bun compilation fails.
 */
const buildExecutable = (): void => {
  const target: string = resolveMuslTarget(
    Bun.env[PROCESS_ARCHITECTURE_ENVIRONMENT_VARIABLE] ?? process.arch,
    Bun.env[MUSL_TARGET_ENVIRONMENT_VARIABLE],
  );
  const argumentsList: readonly string[] = [
    "build",
    EXECUTABLE_ENTRY_POINT,
    "--compile",
    `--target=${target}`,
    "--minify",
    "--bytecode",
    "--no-compile-autoload-dotenv",
    "--no-compile-autoload-bunfig",
    "--compile-exec-argv=--smol",
    ...createExternalArguments(OPTIONAL_RUNTIME_DEPENDENCIES),
    `--outfile=${EXECUTABLE_OUTPUT_PATH}`,
  ];
  const result: Bun.SyncSubprocess<"inherit", "pipe"> = Bun.spawnSync({
    cmd: ["bun", ...argumentsList],
    stderr: "pipe",
    stdout: "inherit",
  });
  if (result.exitCode !== 0) {
    const stderr: string = result.stderr?.toString().trim() ?? EMPTY_PROCESS_OUTPUT;
    throw new Error(
      stderr.length > 0
        ? `Bun executable compilation failed: ${stderr}`
        : `Bun executable compilation failed with code ${result.exitCode}`,
    );
  }
};

buildExecutable();

export { buildExecutable, createExternalArguments, resolveMuslTarget };
