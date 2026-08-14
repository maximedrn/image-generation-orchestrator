import * as TypeScript from "@typescript/typescript6";

import { countNonBlankLines, getLine, inspectNode } from "@scripts/project-policy.helpers.js";
import type { PolicyViolation } from "@scripts/project-policy.helpers.js";

/** Prefix used to detect TypeScript suppression directives without embedding one. */
const TYPESCRIPT_DIRECTIVE_PREFIX = "@ts";

/** Source directories governed by the project policy. */
const POLICY_DIRECTORIES: readonly string[] = ["src", "test", "scripts"];

/** Allowed TypeScript file suffixes for source modules and tooling. */
const ALLOWED_TYPESCRIPT_SUFFIXES: readonly string[] = [
  ".constants.ts",
  ".controller.ts",
  ".factory.ts",
  ".filter.ts",
  ".fixture.ts",
  ".guard.ts",
  ".helpers.ts",
  ".interface.ts",
  ".module.ts",
  ".script.ts",
  ".service.ts",
  ".test.ts",
  ".types.ts",
  ".utils.ts",
];

/** TypeScript entry points allowed outside the regular suffix convention. */
const ALLOWED_TYPESCRIPT_BASENAMES: ReadonlySet<string> = new Set<string>([
  "main.ts",
]);

/** Maximum non-blank lines accepted in one TypeScript file. */
const MAX_FILE_LINES = 300;

/**
 * Checks one TypeScript file against repository policy.
 *
 * @param file - (string) Relative file path.
 * @param text - (string) File contents.
 * @returns (readonly PolicyViolation[]) Detected violations.
 */
const inspectTypeScriptFile = (
  file: string,
  text: string,
): readonly PolicyViolation[] => {
  const violations: PolicyViolation[] = [];
  const sourceFile: TypeScript.SourceFile = TypeScript.createSourceFile(
    file,
    text,
    TypeScript.ScriptTarget.Latest,
    true,
    TypeScript.ScriptKind.TS,
  );
  const nonBlankLines: number = countNonBlankLines(text, 0, text.length);
  if (nonBlankLines > MAX_FILE_LINES) {
    violations.push({ file, line: 1, message: `file exceeds ${MAX_FILE_LINES} non-blank lines` });
  }
  sourceFile.parseDiagnostics.forEach(
    (diagnostic: TypeScript.DiagnosticWithLocation): void => {
      violations.push({
        file,
        line: getLine(sourceFile, diagnostic.start ?? 0),
        message: TypeScript.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      });
    },
  );
  inspectNode(file, text, sourceFile, sourceFile, violations);
  if (text.includes(["as", "unknown", "as"].join(" "))) {
    violations.push({ file, line: 1, message: "double casts through unknown are forbidden" });
  }
  if (new RegExp(`${TYPESCRIPT_DIRECTIVE_PREFIX}-(?:ignore|expect-error)`, "u").test(text)) {
    violations.push({ file, line: 1, message: "TypeScript suppression directives are forbidden" });
  }
  return violations;
};

/**
 * Checks the source filename convention.
 *
 * @param file - (string) Relative TypeScript path.
 * @returns (PolicyViolation | undefined) Violation when the suffix is invalid.
 */
const inspectFileName = (file: string): PolicyViolation | undefined => {
  const basename: string = file.split("/").at(-1) ?? file;
  const accepted: boolean =
    ALLOWED_TYPESCRIPT_BASENAMES.has(basename) ||
    ALLOWED_TYPESCRIPT_SUFFIXES.some((suffix: string): boolean => basename.endsWith(suffix));
  return accepted ? undefined : { file, line: 1, message: "TypeScript filename does not follow the project suffix convention" };
};

/**
 * Materializes an async iterable without relying on proposal-level Array APIs.
 *
 * @param values - (AsyncIterable<T>) Values to consume.
 * @returns (Promise<readonly T[]>) Materialized values in iteration order.
 */
const collectAsync = async <T>(values: AsyncIterable<T>): Promise<readonly T[]> => {
  const collected: T[] = [];
  for await (const value: T of values) {
    collected.push(value);
  }
  return collected;
};

/**
 * Executes the repository policy check.
 *
 * @returns (Promise<void>) Resolves when no violation exists; rejects otherwise.
 */
const runPolicy = async (): Promise<void> => {
  const glob: Bun.Glob = new Bun.Glob("**/*.ts");
  const groups: readonly (readonly string[])[] = await Promise.all(
    POLICY_DIRECTORIES.map(async (directory: string): Promise<readonly string[]> => {
      const files: readonly string[] = await collectAsync(
        glob.scan({ cwd: directory, onlyFiles: true }),
      );
      return files.map((file: string): string => `${directory}/${file}`);
    }),
  );
  const files: readonly string[] = groups.flat().toSorted();
  const inspected: readonly (readonly PolicyViolation[])[] = await Promise.all(
    files.map(async (file: string): Promise<readonly PolicyViolation[]> => {
      const violations: PolicyViolation[] = [];
      const nameViolation: PolicyViolation | undefined = inspectFileName(file);
      if (nameViolation !== undefined) violations.push(nameViolation);
      const text: string = await Bun.file(file).text();
      violations.push(...inspectTypeScriptFile(file, text));
      return violations;
    }),
  );
  const violations: readonly PolicyViolation[] = inspected.flat();
  if (violations.length > 0) {
    const report: string = violations
      .map((violation: PolicyViolation): string => `${violation.file}:${violation.line} ${violation.message}`)
      .join("\n");
    throw new Error(`project policy failed (${violations.length})\n${report}`);
  }
  Bun.stdout.write(`project policy passed for ${files.length} TypeScript files\n`);
};

await runPolicy();

export { inspectFileName, inspectTypeScriptFile, runPolicy };
