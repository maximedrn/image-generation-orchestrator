import * as TypeScript from "@typescript/typescript6";

/** Maximum non-blank lines accepted in one named function or method. */
const MAX_FUNCTION_LINES = 60;

/** Stable policy violation returned by source inspection. */
interface PolicyViolation {
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/**
 * Returns the one-based source line for a node position.
 *
 * @param sourceFile - (TypeScript.SourceFile) Parsed source file.
 * @param position - (number) Character position.
 * @returns (number) One-based line number.
 */
const getLine = (sourceFile: TypeScript.SourceFile, position: number): number =>
  sourceFile.getLineAndCharacterOfPosition(position).line + 1;

/**
 * Counts non-blank lines in a source range.
 *
 * @param text - (string) Complete file text.
 * @param start - (number) Inclusive source offset.
 * @param end - (number) Exclusive source offset.
 * @returns (number) Number of non-blank lines.
 */
const countNonBlankLines = (text: string, start: number, end: number): number =>
  text
    .slice(start, end)
    .split("\n")
    .filter((line: string): boolean => line.trim().length > 0).length;

/**
 * Checks whether a declaration is immediately preceded by a TSDoc block.
 *
 * @param text - (string) Complete file text.
 * @param node - (TypeScript.Node) Declaration node.
 * @returns (boolean) Whether a TSDoc block is present.
 */
const hasTsDoc = (text: string, node: TypeScript.Node): boolean => {
  const comments: readonly TypeScript.CommentRange[] =
    TypeScript.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  const lastComment: TypeScript.CommentRange | undefined = comments.at(-1);
  return (
    lastComment !== undefined &&
    text.slice(lastComment.pos, lastComment.end).startsWith("/**")
  );
};

/**
 * Determines whether one declaration requires callable policy checks.
 *
 * @param node - (TypeScript.Node) Candidate AST node.
 * @returns (boolean) Whether the node is a governed callable declaration.
 */
const isGovernedCallable = (
  node: TypeScript.Node,
): node is TypeScript.FunctionLikeDeclaration =>
  TypeScript.isFunctionDeclaration(node) ||
  TypeScript.isMethodDeclaration(node) ||
  TypeScript.isGetAccessorDeclaration(node) ||
  TypeScript.isSetAccessorDeclaration(node);

/**
 * Adds basic syntax and import policy violations for one node.
 *
 * @param file - (string) Relative source path.
 * @param sourceFile - (TypeScript.SourceFile) Parsed source file.
 * @param node - (TypeScript.Node) Current node.
 * @param violations - (PolicyViolation[]) Mutable violation accumulator.
 * @returns (void) Mutates the supplied accumulator.
 */
const inspectBasicNode = (
  file: string,
  sourceFile: TypeScript.SourceFile,
  node: TypeScript.Node,
  violations: PolicyViolation[],
): void => {
  if (node.kind === TypeScript.SyntaxKind.AnyKeyword) {
    violations.push({ file, line: getLine(sourceFile, node.getStart()), message: "explicit any is forbidden" });
  }
  if (TypeScript.isNonNullExpression(node)) {
    violations.push({ file, line: getLine(sourceFile, node.getStart()), message: "non-null assertions are forbidden" });
  }
  if (
    TypeScript.isImportDeclaration(node) &&
    TypeScript.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text.startsWith(".")
  ) {
    violations.push({ file, line: getLine(sourceFile, node.getStart()), message: "relative imports are forbidden" });
  }
};

/**
 * Enforces explicit local variable annotations in all governed TypeScript.
 *
 * @param file - (string) Relative source path.
 * @param sourceFile - (TypeScript.SourceFile) Parsed source file.
 * @param node - (TypeScript.Node) Current node.
 * @param violations - (PolicyViolation[]) Mutable violation accumulator.
 * @returns (void) Mutates the supplied accumulator.
 */
const inspectExplicitVariable = (
  file: string,
  sourceFile: TypeScript.SourceFile,
  node: TypeScript.Node,
  violations: PolicyViolation[],
): void => {
  if (
    !TypeScript.isVariableDeclaration(node) ||
    !TypeScript.isIdentifier(node.name) ||
    node.type !== undefined
  ) {
    return;
  }
  const declarationContainer: TypeScript.Node = node.parent.parent;
  const isModuleVariable: boolean =
    TypeScript.isVariableStatement(declarationContainer) &&
    declarationContainer.parent === sourceFile;
  if (!isModuleVariable) {
    violations.push({
      file,
      line: getLine(sourceFile, node.getStart()),
      message: `local variable needs an explicit type: ${node.name.text}`,
    });
  }
};

/**
 * Enforces TSDoc and size rules for named functions and class members.
 *
 * @param file - (string) Relative source path.
 * @param text - (string) Complete file text.
 * @param sourceFile - (TypeScript.SourceFile) Parsed source file.
 * @param node - (TypeScript.Node) Current node.
 * @param violations - (PolicyViolation[]) Mutable violation accumulator.
 * @returns (void) Mutates the supplied accumulator.
 */
const inspectDocumentedCallable = (
  file: string,
  text: string,
  sourceFile: TypeScript.SourceFile,
  node: TypeScript.Node,
  violations: PolicyViolation[],
): void => {
  if (TypeScript.isClassDeclaration(node) && !hasTsDoc(text, node)) {
    violations.push({ file, line: getLine(sourceFile, node.getStart()), message: "class must have TSDoc" });
  }
  if (TypeScript.isVariableStatement(node)) {
    const hasNamedFunction: boolean = node.declarationList.declarations.some(
      (declaration: TypeScript.VariableDeclaration): boolean =>
        declaration.initializer !== undefined &&
        (TypeScript.isArrowFunction(declaration.initializer) ||
          TypeScript.isFunctionExpression(declaration.initializer)),
    );
    if (hasNamedFunction && !hasTsDoc(text, node)) {
      violations.push({ file, line: getLine(sourceFile, node.getStart()), message: "named function expression must have TSDoc" });
    }
  }
  if (!isGovernedCallable(node)) return;
  if (!hasTsDoc(text, node)) {
    violations.push({ file, line: getLine(sourceFile, node.getStart()), message: "function or method must have TSDoc" });
  }
  if (node.type === undefined && !TypeScript.isSetAccessorDeclaration(node)) {
    violations.push({ file, line: getLine(sourceFile, node.getStart()), message: "function or method needs an explicit return type" });
  }
  const lines: number = countNonBlankLines(text, node.getStart(), node.getEnd());
  if (lines > MAX_FUNCTION_LINES) {
    violations.push({ file, line: getLine(sourceFile, node.getStart()), message: `function exceeds ${MAX_FUNCTION_LINES} non-blank lines` });
  }
};

/**
 * Recursively checks one AST node against project policy.
 *
 * @param file - (string) Relative source path.
 * @param text - (string) Complete file text.
 * @param sourceFile - (TypeScript.SourceFile) Parsed source file.
 * @param node - (TypeScript.Node) Current node.
 * @param violations - (PolicyViolation[]) Mutable violation accumulator.
 * @returns (void) Mutates the supplied accumulator.
 */
const inspectNode = (
  file: string,
  text: string,
  sourceFile: TypeScript.SourceFile,
  node: TypeScript.Node,
  violations: PolicyViolation[],
): void => {
  inspectBasicNode(file, sourceFile, node, violations);
  inspectExplicitVariable(file, sourceFile, node, violations);
  inspectDocumentedCallable(file, text, sourceFile, node, violations);
  TypeScript.forEachChild(
    node,
    (child: TypeScript.Node): void => inspectNode(file, text, sourceFile, child, violations),
  );
};

export { countNonBlankLines, getLine, inspectNode };
export type { PolicyViolation };
