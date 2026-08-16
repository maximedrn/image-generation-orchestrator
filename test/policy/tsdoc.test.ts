import { describe, expect, test } from "bun:test";

// Biome's GritQL plugins cannot see leading trivia, so TSDoc presence is the one
// project rule the linter cannot express. It is checked here instead of by a
// standalone script, so `bun test` remains the single gate.

/** Directories governed by the documentation rule. */
const DocumentedRoots: readonly string[] = ["src", "test"];

/** Declarations that must carry a TSDoc block. */
const DeclarationPattern =
  /^(?:const|class|interface|type|function)\s+[A-Za-z]/u;

/** Lines that close a TSDoc block or continue one. */
const DocumentationPattern: RegExp = /^\s*(?:\*\/|\/\*\*|\/\/)/u;

/** Decorator lines sit between the TSDoc block and the declaration it documents. */
const DecoratorPattern: RegExp = /^\s*[@)\]}]/u;

/** Any documented parameter, whatever shape its type annotation takes. */
const ParamPattern: RegExp = /^\s*\*\s*@param\b/u;

/** Any documented return value, whatever shape its type annotation takes. */
const ReturnsPattern: RegExp = /^\s*\*\s*@returns\b/u;

/** Required parameter shape: `@param {Type} name - description`. */
const TypedParamPattern =
  /^\s*\*\s*@param\s+\{.+\}\s+[A-Za-z_$][\w$]*\s+-\s+\S/u;

/** Required return shape: `@returns {Type} description`. */
const TypedReturnsPattern: RegExp = /^\s*\*\s*@returns\s+\{.+\}\s+\S/u;

/**
 * Collects every TypeScript file governed by the documentation rule.
 *
 * @returns {Promise<readonly string[]>} Sorted repository-relative paths.
 */
const listSourceFiles = async (): Promise<readonly string[]> => {
  const glob: Bun.Glob = new Bun.Glob("**/*.ts");
  const groups: readonly (readonly string[])[] = await Promise.all(
    DocumentedRoots.map(async (root: string): Promise<readonly string[]> => {
      const files: string[] = [];
      for await (const file of glob.scan({ cwd: root, onlyFiles: true })) {
        files.push(`${root}/${file}`);
      }
      return files;
    }),
  );
  return groups.flat().toSorted();
};

/**
 * Reports every top-level declaration that is not preceded by a TSDoc block.
 *
 * @param {string} file - Repository-relative path.
 * @param {string} text - File contents.
 * @returns {readonly string[]} Human-readable violations.
 */
const findUndocumented = (file: string, text: string): readonly string[] => {
  const lines: readonly string[] = text.split("\n");
  return lines.flatMap((line: string, index: number): readonly string[] => {
    if (!DeclarationPattern.test(line)) return [];
    let cursor: number = index - 1;
    while (DecoratorPattern.test(lines[cursor] ?? "")) cursor -= 1;
    const previous: string = lines[cursor] ?? "";
    return DocumentationPattern.test(previous)
      ? []
      : [`${file}:${index + 1} ${line.trim().slice(0, 60)}`];
  });
};

/**
 * Reports every TSDoc tag that does not declare its type in braces.
 *
 * @param {string} file - Repository-relative path.
 * @param {string} text - File contents.
 * @returns {readonly string[]} Human-readable violations.
 */
const findUntypedTags = (file: string, text: string): readonly string[] =>
  text.split("\n").flatMap((line: string, index: number): readonly string[] => {
    const untypedParam: boolean =
      ParamPattern.test(line) && !TypedParamPattern.test(line);
    const untypedReturns: boolean =
      ReturnsPattern.test(line) && !TypedReturnsPattern.test(line);
    return untypedParam || untypedReturns
      ? [`${file}:${index + 1} ${line.trim().slice(0, 70)}`]
      : [];
  });

/**
 * Applies one documentation check to every governed source file.
 *
 * @param {(file: string, text: string) => readonly string[]} check - Per-file rule.
 * @returns {Promise<readonly string[]>} Every violation the rule found.
 */
const collectViolations = async (
  check: (file: string, text: string) => readonly string[],
): Promise<readonly string[]> => {
  const files: readonly string[] = await listSourceFiles();
  const results: readonly (readonly string[])[] = await Promise.all(
    files.map(
      async (file: string): Promise<readonly string[]> =>
        check(file, await Bun.file(file).text()),
    ),
  );
  return results.flat();
};

describe("documentation policy", (): void => {
  test("every top-level declaration carries a TSDoc block", async (): Promise<void> => {
    expect(await collectViolations(findUndocumented)).toEqual([]);
  });

  test("every @param and @returns declares its type in braces", async (): Promise<void> => {
    expect(await collectViolations(findUntypedTags)).toEqual([]);
  });
});
