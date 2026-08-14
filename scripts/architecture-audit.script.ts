import * as TypeScript from "@typescript/typescript6";

import {
  buildSourceIndex,
  getNodeLine,
  inspectCallableSignature,
  inspectImport,
} from "@scripts/architecture-audit.helpers.js";
import type {
  ArchitectureViolation,
  SourceMetadata,
} from "@scripts/architecture-audit.helpers.js";
import {
  ARCHITECTURE_SOURCE_ROOTS,
  STABLE_DIFFUSION_ADAPTER_FRAGMENT,
} from "@scripts/architecture-audit.constants.js";

/**
 * Validates one source module against repository architecture boundaries.
 *
 * @param file - (string) Repository-relative source path.
 * @param metadata - (SourceMetadata) Parsed module metadata.
 * @param sourceIndex - (ReadonlyMap<string, SourceMetadata>) Repository module index.
 * @returns (readonly ArchitectureViolation[]) Module violations.
 */
const inspectSource = (
  file: string,
  metadata: SourceMetadata,
  sourceIndex: ReadonlyMap<string, SourceMetadata>,
): readonly ArchitectureViolation[] => {
  const violations: ArchitectureViolation[] = [];
  /**
   * Recursively validates one AST node.
   *
   * @param node - (TypeScript.Node) Current AST node.
   * @returns (void) Mutates the local violation accumulator.
   */
  const visit: (node: TypeScript.Node) => void = (
    node: TypeScript.Node,
  ): void => {
    if (node.kind === TypeScript.SyntaxKind.AnyKeyword) {
      violations.push({
        file,
        line: getNodeLine(metadata.sourceFile, node),
        message: "explicit any is forbidden",
      });
    }
    if (TypeScript.isImportDeclaration(node)) {
      violations.push(
        ...inspectImport(file, metadata.sourceFile, node, sourceIndex),
      );
      if (
        TypeScript.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text.includes(STABLE_DIFFUSION_ADAPTER_FRAGMENT) &&
        !file.startsWith("src/engine/stable-diffusion") &&
        file !== "src/engine/engine.factory.ts"
      ) {
        violations.push({
          file,
          line: getNodeLine(metadata.sourceFile, node),
          message: "stable-diffusion.cpp protocol leaked outside its adapter boundary",
        });
      }
    }
    violations.push(...inspectCallableSignature(file, metadata.sourceFile, node));
    TypeScript.forEachChild(node, visit);
  };
  visit(metadata.sourceFile);
  return violations;
};

/**
 * Materializes an async iterable without proposal-level Array APIs.
 *
 * @param values - (AsyncIterable<T>) Values to consume.
 * @returns (Promise<readonly T[]>) Materialized values in iteration order.
 */
const collectAsync = async <T>(values: AsyncIterable<T>): Promise<readonly T[]> => {
  const collected: T[] = [];
  for await (const value: T of values) collected.push(value);
  return collected;
};

/**
 * Enumerates all TypeScript files governed by the architecture audit.
 *
 * @returns (Promise<readonly string[]>) Sorted repository-relative paths.
 */
const listArchitectureFiles = async (): Promise<readonly string[]> => {
  const glob: Bun.Glob = new Bun.Glob("**/*.ts");
  const groups: readonly (readonly string[])[] = await Promise.all(
    ARCHITECTURE_SOURCE_ROOTS.map(
      async (root: string): Promise<readonly string[]> => {
        const files: readonly string[] = await collectAsync(
          glob.scan({ cwd: root, onlyFiles: true }),
        );
        return files.map((file: string): string => `${root}/${file}`);
      },
    ),
  );
  return groups.flat().toSorted();
};

/**
 * Executes the architecture audit and rejects on any invariant violation.
 *
 * @returns (Promise<void>) Completion when all architecture rules pass.
 */
const runArchitectureAudit = async (): Promise<void> => {
  const files: readonly string[] = await listArchitectureFiles();
  const sourceIndex: ReadonlyMap<string, SourceMetadata> =
    await buildSourceIndex(files);
  const violations: ArchitectureViolation[] = files.flatMap(
    (file: string): readonly ArchitectureViolation[] => {
      const metadata: SourceMetadata | undefined = sourceIndex.get(file);
      return metadata === undefined ? [] : inspectSource(file, metadata, sourceIndex);
    },
  );
  if (violations.length > 0) {
    const report: string = violations
      .map(
        (violation: ArchitectureViolation): string =>
          `${violation.file}:${violation.line} ${violation.message}`,
      )
      .join("\n");
    throw new Error(`architecture audit failed (${violations.length})\n${report}`);
  }
  Bun.stdout.write(
    `architecture audit passed for ${files.length} TypeScript files\n`,
  );
};

await runArchitectureAudit();
