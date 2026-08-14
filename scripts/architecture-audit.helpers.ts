import * as TypeScript from "@typescript/typescript6";

import { LOCAL_IMPORT_ROOT } from "@scripts/architecture-audit.constants.js";

/** One architecture rule violation with source location. */
interface ArchitectureViolation {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** Parsed source metadata used for local import/export validation. */
interface SourceMetadata {
  readonly exportedNames: ReadonlySet<string>;
  readonly sourceFile: TypeScript.SourceFile;
}

/**
 * Returns the one-based source line containing an AST node.
 *
 * @param sourceFile - (TypeScript.SourceFile) Parsed TypeScript source file.
 * @param node - (TypeScript.Node) Node whose source line is requested.
 * @returns (number) One-based source line.
 */
const getNodeLine = (
  sourceFile: TypeScript.SourceFile,
  node: TypeScript.Node,
): number => sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

/**
 * Resolves a repository alias import to its TypeScript source path.
 *
 * @param moduleSpecifier - (string) Module specifier from an import declaration.
 * @returns (string | undefined) Repository source path when the import is local.
 */
const resolveLocalImport = (moduleSpecifier: string): string | undefined => {
  for (const [prefix, root] of Object.entries(LOCAL_IMPORT_ROOT)) {
    if (moduleSpecifier.startsWith(prefix)) {
      const suffix: string = moduleSpecifier.slice(prefix.length);
      const sourceSuffix: string = suffix.endsWith(".js")
        ? `${suffix.slice(0, -3)}.ts`
        : suffix;
      return `${root}${sourceSuffix}`;
    }
  }
  return undefined;
};

/**
 * Detects whether an AST declaration carries the export modifier.
 *
 * @param node - (TypeScript.Node) Candidate declaration.
 * @returns (boolean) Whether the declaration is explicitly exported.
 */
const isExportedDeclaration = (node: TypeScript.Node): boolean =>
  TypeScript.canHaveModifiers(node) &&
  (TypeScript.getModifiers(node)?.some(
    (modifier: TypeScript.Modifier): boolean =>
      modifier.kind === TypeScript.SyntaxKind.ExportKeyword,
  ) ?? false);

/**
 * Collects exported symbol names from one parsed module.
 *
 * @param sourceFile - (TypeScript.SourceFile) Parsed TypeScript module.
 * @returns (ReadonlySet<string>) Names available to repository named imports.
 */
const collectExportedNames = (
  sourceFile: TypeScript.SourceFile,
): ReadonlySet<string> => {
  const names: Set<string> = new Set<string>();
  sourceFile.statements.forEach((statement: TypeScript.Statement): void => {
    if (TypeScript.isExportDeclaration(statement)) {
      const clause: TypeScript.NamedExportBindings | undefined =
        statement.exportClause;
      if (clause !== undefined && TypeScript.isNamedExports(clause)) {
        clause.elements.forEach((element: TypeScript.ExportSpecifier): void => {
          names.add(element.name.text);
        });
      }
      return;
    }
    if (
      isExportedDeclaration(statement) &&
      "name" in statement &&
      statement.name !== undefined &&
      TypeScript.isIdentifier(statement.name)
    ) {
      names.add(statement.name.text);
    }
  });
  return names;
};

/**
 * Parses all governed source files and indexes their exported names.
 *
 * @param files - (readonly string[]) Repository-relative TypeScript files.
 * @returns (Promise<ReadonlyMap<string, SourceMetadata>>) Parsed source index.
 */
const buildSourceIndex = async (
  files: readonly string[],
): Promise<ReadonlyMap<string, SourceMetadata>> => {
  const index: Map<string, SourceMetadata> = new Map<string, SourceMetadata>();
  await Promise.all(
    files.map(async (file: string): Promise<void> => {
      const text: string = await Bun.file(file).text();
      const sourceFile: TypeScript.SourceFile = TypeScript.createSourceFile(
        file,
        text,
        TypeScript.ScriptTarget.Latest,
        true,
        TypeScript.ScriptKind.TS,
      );
      index.set(file, {
        exportedNames: collectExportedNames(sourceFile),
        sourceFile,
      });
    }),
  );
  return index;
};

/**
 * Validates an individual local import declaration.
 *
 * @param file - (string) Importing module path.
 * @param sourceFile - (TypeScript.SourceFile) Parsed importing module.
 * @param node - (TypeScript.ImportDeclaration) Import declaration.
 * @param sourceIndex - (ReadonlyMap<string, SourceMetadata>) Repository module index.
 * @returns (readonly ArchitectureViolation[]) Import violations.
 */
const inspectImport = (
  file: string,
  sourceFile: TypeScript.SourceFile,
  node: TypeScript.ImportDeclaration,
  sourceIndex: ReadonlyMap<string, SourceMetadata>,
): readonly ArchitectureViolation[] => {
  if (!TypeScript.isStringLiteral(node.moduleSpecifier)) return [];
  const specifier: string = node.moduleSpecifier.text;
  if (specifier.startsWith(".")) {
    return [
      {
        file,
        line: getNodeLine(sourceFile, node),
        message: "relative imports are forbidden",
      },
    ];
  }
  const target: string | undefined = resolveLocalImport(specifier);
  if (target === undefined) return [];
  const targetMetadata: SourceMetadata | undefined = sourceIndex.get(target);
  if (targetMetadata === undefined) {
    return [
      {
        file,
        line: getNodeLine(sourceFile, node),
        message: `local import target does not exist: ${target}`,
      },
    ];
  }
  const violations: ArchitectureViolation[] = [];
  const bindings: TypeScript.NamedImportBindings | undefined =
    node.importClause?.namedBindings;
  if (bindings !== undefined && TypeScript.isNamedImports(bindings)) {
    bindings.elements.forEach((element: TypeScript.ImportSpecifier): void => {
      const importedName: string = element.propertyName?.text ?? element.name.text;
      if (!targetMetadata.exportedNames.has(importedName)) {
        violations.push({
          file,
          line: getNodeLine(sourceFile, element),
          message: `missing named export ${importedName} in ${target}`,
        });
      }
    });
  }
  return violations;
};

/**
 * Checks explicit types on every function-like expression and declaration.
 *
 * @param file - (string) Repository-relative source path.
 * @param sourceFile - (TypeScript.SourceFile) Parsed source file.
 * @param node - (TypeScript.Node) Candidate AST node.
 * @returns (readonly ArchitectureViolation[]) Signature violations.
 */
const inspectCallableSignature = (
  file: string,
  sourceFile: TypeScript.SourceFile,
  node: TypeScript.Node,
): readonly ArchitectureViolation[] => {
  if (!TypeScript.isFunctionLike(node) || TypeScript.isConstructorDeclaration(node)) {
    return [];
  }
  const violations: ArchitectureViolation[] = [];
  if (node.type === undefined && !TypeScript.isSetAccessorDeclaration(node)) {
    violations.push({
      file,
      line: getNodeLine(sourceFile, node),
      message: "callable return type must be explicit",
    });
  }
  node.parameters.forEach((parameter: TypeScript.ParameterDeclaration): void => {
    if (parameter.type === undefined) {
      violations.push({
        file,
        line: getNodeLine(sourceFile, parameter),
        message: `parameter type must be explicit: ${parameter.name.getText(sourceFile)}`,
      });
    }
  });
  return violations;
};

export {
  buildSourceIndex,
  getNodeLine,
  inspectCallableSignature,
  inspectImport,
};
export type { ArchitectureViolation, SourceMetadata };
