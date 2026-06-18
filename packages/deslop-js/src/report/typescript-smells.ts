import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseSync } from "oxc-parser";
import type {
  CommonjsInEsm,
  DependencyGraph,
  LazyImportAtTopLevel,
  TypeScriptEscapeHatch,
  TypeScriptEscapeHatchKind,
  UnnecessaryAssertion,
  UnnecessaryAssertionKind,
} from "../types.js";
import { computeLineStarts } from "../utils/compute-line-starts.js";
import { offsetToLineColumn } from "../utils/offset-to-line-column.js";
import { isAstNode } from "../utils/is-ast-node.js";

interface ParsedSourceComment {
  type: "Line" | "Block";
  value: string;
  start: number;
  end: number;
}

interface ParsedSource {
  programNode: unknown;
  sourceText: string;
  lineStarts: number[];
  comments: ParsedSourceComment[];
}

const parseSource = (filePath: string): ParsedSource | undefined => {
  let sourceText: string;
  try {
    sourceText = readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
  let parseResult: ReturnType<typeof parseSync>;
  try {
    parseResult = parseSync(filePath, sourceText);
  } catch {
    return undefined;
  }
  const rawComments = (parseResult as unknown as { comments?: unknown }).comments;
  const comments = Array.isArray(rawComments) ? rawComments.filter(isParsedSourceComment) : [];
  return {
    programNode: parseResult.program,
    sourceText,
    lineStarts: computeLineStarts(sourceText),
    comments,
  };
};

const isParsedSourceComment = (candidate: unknown): candidate is ParsedSourceComment => {
  if (typeof candidate !== "object" || candidate === null) return false;
  const fields = candidate as Record<string, unknown>;
  return (
    (fields.type === "Line" || fields.type === "Block") &&
    typeof fields.value === "string" &&
    typeof fields.start === "number" &&
    typeof fields.end === "number"
  );
};

const sliceSnippet = (sourceText: string, start: number, end: number): string => {
  const SNIPPET_BUDGET_CHARS = 80;
  const raw = sourceText
    .slice(start, Math.min(end, start + SNIPPET_BUDGET_CHARS))
    .replace(/\s+/g, " ")
    .trim();
  return end - start > SNIPPET_BUDGET_CHARS ? `${raw}…` : raw;
};

const isAnyOrUnknownTypeAnnotation = (typeAnnotation: unknown): "any" | "unknown" | undefined => {
  if (!isAstNode(typeAnnotation)) return undefined;
  if (typeAnnotation.type === "TSAnyKeyword") return "any";
  if (typeAnnotation.type === "TSUnknownKeyword") return "unknown";
  return undefined;
};

const isLiteralLikeNonNull = (expression: unknown): boolean => {
  if (!isAstNode(expression)) return false;
  if (expression.type === "Literal") {
    const literalValue = expression.value;
    return literalValue !== null;
  }
  if (
    expression.type === "TemplateLiteral" ||
    expression.type === "ArrayExpression" ||
    expression.type === "ObjectExpression" ||
    expression.type === "FunctionExpression" ||
    expression.type === "ArrowFunctionExpression" ||
    expression.type === "ClassExpression"
  ) {
    return true;
  }
  return false;
};

const collectUnnecessaryAssertionsInNode = (
  node: unknown,
  filePath: string,
  sourceText: string,
  lineStarts: number[],
  results: UnnecessaryAssertion[],
): void => {
  if (!isAstNode(node)) return;

  if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") {
    const innerExpression = node.expression;
    const typeAnnotation = node.typeAnnotation;

    if (node.type === "TSAsExpression") {
      const outerKind = isAnyOrUnknownTypeAnnotation(typeAnnotation);
      if (
        outerKind === undefined &&
        isAstNode(innerExpression) &&
        innerExpression.type === "TSAsExpression"
      ) {
        const innerTypeAnnotation = innerExpression.typeAnnotation;
        const innerKind = isAnyOrUnknownTypeAnnotation(innerTypeAnnotation);
        if (innerKind !== undefined) {
          pushAssertion(
            node,
            "redundant-double-assertion",
            `\`x as ${innerKind} as T\` first widens to ${innerKind} just to assert to T — drop the intermediate ${innerKind} and assert directly`,
            "if you must assert, write `x as T` directly",
            filePath,
            sourceText,
            lineStarts,
            results,
          );
        }
      }
      if (outerKind === "any") {
        pushAssertion(
          node,
          "assertion-to-any",
          "`as any` opts out of TypeScript's type system — narrow to a specific type or use `unknown`",
          "replace `as any` with the actual type, or use `as unknown as T` only when you genuinely need to discard the inferred type",
          filePath,
          sourceText,
          lineStarts,
          results,
        );
      }
    }
  }

  if (node.type === "TSTypeAssertion") {
    pushAssertion(
      node,
      "angle-bracket-assertion",
      "`<T>x` style assertion is parsed as a JSX tag in `.tsx` and is deprecated in mixed-extension projects — prefer `x as T`",
      "rewrite `<T>x` as `x as T`",
      filePath,
      sourceText,
      lineStarts,
      results,
    );
  }

  if (node.type === "TSNonNullExpression") {
    const innerExpression = node.expression;
    if (isAstNode(innerExpression) && innerExpression.type === "TSNonNullExpression") {
      pushAssertion(
        node,
        "double-non-null",
        "`x!!` is the non-null assertion applied twice — the second `!` is always a no-op",
        "drop one of the `!` operators",
        filePath,
        sourceText,
        lineStarts,
        results,
      );
    } else if (isLiteralLikeNonNull(innerExpression)) {
      pushAssertion(
        node,
        "redundant-non-null-on-literal",
        "`!` after a literal / array / object / function expression is redundant — those values are never null",
        "remove the trailing `!`",
        filePath,
        sourceText,
        lineStarts,
        results,
      );
    }
  }
};

const pushAssertion = (
  node: unknown,
  kind: UnnecessaryAssertionKind,
  reason: string,
  suggestion: string,
  filePath: string,
  sourceText: string,
  lineStarts: number[],
  results: UnnecessaryAssertion[],
): void => {
  if (!isAstNode(node)) return;
  const startOffset = node.start;
  const endOffset = node.end;
  if (typeof startOffset !== "number" || typeof endOffset !== "number") return;
  const { line, column } = offsetToLineColumn(startOffset, lineStarts);
  const isHighConfidenceKind =
    kind === "double-non-null" ||
    kind === "redundant-non-null-on-literal" ||
    kind === "redundant-double-assertion";
  results.push({
    path: filePath,
    kind,
    snippet: sliceSnippet(sourceText, startOffset, endOffset),
    line,
    column,
    confidence: isHighConfidenceKind ? "high" : "medium",
    reason,
    suggestion,
  });
};

const visitForUnnecessaryAssertions = (
  node: unknown,
  filePath: string,
  sourceText: string,
  lineStarts: number[],
  results: UnnecessaryAssertion[],
): void => {
  if (!isAstNode(node)) return;
  collectUnnecessaryAssertionsInNode(node, filePath, sourceText, lineStarts, results);
  for (const propertyKey of Object.keys(node)) {
    if (
      propertyKey === "type" ||
      propertyKey === "start" ||
      propertyKey === "end" ||
      propertyKey === "loc" ||
      propertyKey === "range"
    ) {
      continue;
    }
    const value = node[propertyKey];
    if (Array.isArray(value)) {
      for (const item of value) {
        visitForUnnecessaryAssertions(item, filePath, sourceText, lineStarts, results);
      }
    } else if (value !== null && typeof value === "object") {
      visitForUnnecessaryAssertions(value, filePath, sourceText, lineStarts, results);
    }
  }
};

const importExpressionSpecifier = (importExpression: unknown): string | undefined => {
  if (!isAstNode(importExpression)) return undefined;
  if (importExpression.type !== "ImportExpression") return undefined;
  const sourceNode = importExpression.source;
  if (!isAstNode(sourceNode)) return undefined;
  if (sourceNode.type !== "Literal") return undefined;
  const literalValue = sourceNode.value;
  return typeof literalValue === "string" ? literalValue : undefined;
};

const findThenImportInExpressionStatement = (
  expressionNode: unknown,
): { importExpression: unknown; specifier: string } | undefined => {
  if (!isAstNode(expressionNode)) return undefined;
  if (expressionNode.type !== "CallExpression") return undefined;
  const callee = expressionNode.callee;
  if (!isAstNode(callee)) return undefined;
  if (callee.type !== "MemberExpression" && callee.type !== "StaticMemberExpression")
    return undefined;
  const propertyNode = callee.property;
  const propertyName = isAstNode(propertyNode) ? propertyNode.name : undefined;
  if (propertyName !== "then" && propertyName !== "catch" && propertyName !== "finally")
    return undefined;
  const objectNode = callee.object;
  const specifier = importExpressionSpecifier(objectNode);
  if (specifier === undefined) return undefined;
  return { importExpression: objectNode, specifier };
};

const findAwaitImportInExpression = (
  expressionNode: unknown,
): { importExpression: unknown; specifier: string } | undefined => {
  if (!isAstNode(expressionNode)) return undefined;
  if (expressionNode.type !== "AwaitExpression") return undefined;
  const argumentNode = expressionNode.argument;
  const specifier = importExpressionSpecifier(argumentNode);
  if (specifier === undefined) return undefined;
  return { importExpression: argumentNode, specifier };
};

const collectLazyImportsAtTopLevel = (
  programNode: unknown,
  filePath: string,
  lineStarts: number[],
  results: LazyImportAtTopLevel[],
): void => {
  if (!isAstNode(programNode)) return;
  const programBody = programNode.body;
  if (!Array.isArray(programBody)) return;

  for (const topLevelStatement of programBody) {
    if (!isAstNode(topLevelStatement)) continue;

    if (topLevelStatement.type === "VariableDeclaration") {
      const declarators = topLevelStatement.declarations;
      if (!Array.isArray(declarators)) continue;
      for (const declarator of declarators) {
        if (!isAstNode(declarator)) continue;
        const initializer = declarator.init;
        const awaitImport = findAwaitImportInExpression(initializer);
        if (awaitImport) {
          recordLazyImport(awaitImport, "top-level-await-import", filePath, lineStarts, results);
        }
      }
      continue;
    }

    if (topLevelStatement.type === "ExpressionStatement") {
      const innerExpression = topLevelStatement.expression;
      const awaitImport = findAwaitImportInExpression(innerExpression);
      if (awaitImport) {
        recordLazyImport(awaitImport, "top-level-await-import", filePath, lineStarts, results);
        continue;
      }
      const thenImport = findThenImportInExpressionStatement(innerExpression);
      if (thenImport) {
        recordLazyImport(thenImport, "top-level-then-import", filePath, lineStarts, results);
      }
    }
  }
};

const recordLazyImport = (
  match: { importExpression: unknown; specifier: string },
  kind: LazyImportAtTopLevel["kind"],
  filePath: string,
  lineStarts: number[],
  results: LazyImportAtTopLevel[],
): void => {
  if (!isAstNode(match.importExpression)) return;
  const startOffset = match.importExpression.start;
  if (typeof startOffset !== "number") return;
  const { line, column } = offsetToLineColumn(startOffset, lineStarts);
  results.push({
    path: filePath,
    specifier: match.specifier,
    kind,
    line,
    column,
    confidence: kind === "top-level-await-import" ? "high" : "medium",
    reason:
      kind === "top-level-await-import"
        ? `top-level \`await import("${match.specifier}")\` runs synchronously before the module finishes loading anyway — there is no laziness benefit, prefer a static \`import\``
        : `top-level \`import("${match.specifier}").then(...)\` runs at module evaluation — prefer a static \`import\` and a regular function call unless the dynamic-import contract is intentional`,
  });
};

interface PackageJsonTypeCache {
  resolveModuleType: (filePath: string) => "module" | "commonjs" | undefined;
}

const buildPackageJsonTypeCache = (): PackageJsonTypeCache => {
  const directoryToType = new Map<string, "module" | "commonjs" | undefined>();
  const resolveModuleType = (filePath: string): "module" | "commonjs" | undefined => {
    let currentDirectory = dirname(resolve(filePath));
    const visitedDirectories: string[] = [];
    while (true) {
      visitedDirectories.push(currentDirectory);
      const cached = directoryToType.get(currentDirectory);
      if (cached !== undefined) {
        for (const visitedDirectory of visitedDirectories)
          directoryToType.set(visitedDirectory, cached);
        return cached;
      }
      const packageJsonPath = join(currentDirectory, "package.json");
      if (existsSync(packageJsonPath)) {
        try {
          const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
            type?: string;
          };
          const moduleType =
            packageJson.type === "module"
              ? ("module" as const)
              : packageJson.type === "commonjs"
                ? ("commonjs" as const)
                : undefined;
          for (const visitedDirectory of visitedDirectories)
            directoryToType.set(visitedDirectory, moduleType);
          return moduleType;
        } catch {
          for (const visitedDirectory of visitedDirectories)
            directoryToType.set(visitedDirectory, undefined);
          return undefined;
        }
      }
      const parentDirectory = dirname(currentDirectory);
      if (parentDirectory === currentDirectory) {
        for (const visitedDirectory of visitedDirectories)
          directoryToType.set(visitedDirectory, undefined);
        return undefined;
      }
      currentDirectory = parentDirectory;
    }
  };
  return { resolveModuleType };
};

const isEsmFilePath = (filePath: string, typeCache: PackageJsonTypeCache): boolean => {
  if (filePath.endsWith(".mts") || filePath.endsWith(".mjs")) return true;
  if (filePath.endsWith(".cts") || filePath.endsWith(".cjs")) return false;
  const moduleType = typeCache.resolveModuleType(filePath);
  return moduleType === "module";
};

const collectCommonjsInEsm = (
  programNode: unknown,
  filePath: string,
  sourceText: string,
  lineStarts: number[],
  results: CommonjsInEsm[],
): void => {
  if (!isAstNode(programNode)) return;
  visitForCommonjs(programNode, filePath, sourceText, lineStarts, results);
};

const visitForCommonjs = (
  node: unknown,
  filePath: string,
  sourceText: string,
  lineStarts: number[],
  results: CommonjsInEsm[],
): void => {
  if (!isAstNode(node)) return;

  if (node.type === "CallExpression") {
    const callee = node.callee;
    if (isAstNode(callee) && callee.type === "Identifier") {
      const calleeName = callee.name;
      if (calleeName === "require") {
        const callArguments = node.arguments;
        if (Array.isArray(callArguments) && callArguments.length > 0) {
          const firstArgument = callArguments[0];
          if (
            isAstNode(firstArgument) &&
            firstArgument.type === "Literal" &&
            typeof firstArgument.value === "string"
          ) {
            const startOffset = node.start;
            const endOffset = node.end;
            if (typeof startOffset === "number" && typeof endOffset === "number") {
              const { line, column } = offsetToLineColumn(startOffset, lineStarts);
              results.push({
                path: filePath,
                kind: "require",
                line,
                column,
                confidence: "high",
                reason:
                  "synchronous `require()` is unavailable in native ESM — use a static `import` or top-level `await import()`",
                snippet: sliceSnippet(sourceText, startOffset, endOffset),
              });
            }
          }
        }
      }
    }
  }

  if (node.type === "AssignmentExpression") {
    const leftSide = node.left;
    if (isAstNode(leftSide)) {
      const isMemberExpr =
        leftSide.type === "MemberExpression" || leftSide.type === "StaticMemberExpression";
      if (isMemberExpr) {
        const objectNode = leftSide.object;
        const propertyNode = leftSide.property;
        const objectName = isAstNode(objectNode) ? objectNode.name : undefined;
        const propertyName = isAstNode(propertyNode) ? propertyNode.name : undefined;
        if (objectName === "module" && propertyName === "exports") {
          const startOffset = node.start;
          const endOffset = node.end;
          if (typeof startOffset === "number" && typeof endOffset === "number") {
            const { line, column } = offsetToLineColumn(startOffset, lineStarts);
            results.push({
              path: filePath,
              kind: "module-exports",
              line,
              column,
              confidence: "high",
              reason:
                "`module.exports = ...` is CommonJS — replace with `export default` or named `export` for ESM",
              snippet: sliceSnippet(sourceText, startOffset, endOffset),
            });
          }
        } else if (objectName === "exports") {
          const startOffset = node.start;
          const endOffset = node.end;
          if (typeof startOffset === "number" && typeof endOffset === "number") {
            const { line, column } = offsetToLineColumn(startOffset, lineStarts);
            results.push({
              path: filePath,
              kind: "exports-assignment",
              line,
              column,
              confidence: "high",
              reason: "`exports.x = ...` is CommonJS — replace with a named `export` for ESM",
              snippet: sliceSnippet(sourceText, startOffset, endOffset),
            });
          }
        }
      }
    }
  }

  for (const propertyKey of Object.keys(node)) {
    if (
      propertyKey === "type" ||
      propertyKey === "start" ||
      propertyKey === "end" ||
      propertyKey === "loc" ||
      propertyKey === "range"
    ) {
      continue;
    }
    const value = node[propertyKey];
    if (Array.isArray(value)) {
      for (const item of value) visitForCommonjs(item, filePath, sourceText, lineStarts, results);
    } else if (value !== null && typeof value === "object") {
      visitForCommonjs(value, filePath, sourceText, lineStarts, results);
    }
  }
};

const TS_IGNORE_LEADING = /^\s*@ts-ignore\b/;
const TS_NOCHECK_LEADING = /^\s*@ts-nocheck\b/;
const TS_EXPECT_ERROR_LEADING = /^\s*@ts-expect-error\b(.*)$/;

const collectTypeScriptEscapeHatches = (
  comments: ParsedSourceComment[],
  filePath: string,
  lineStarts: number[],
  results: TypeScriptEscapeHatch[],
): void => {
  for (const comment of comments) {
    const commentBody = comment.type === "Block" ? comment.value.split("\n")[0] : comment.value;
    if (TS_IGNORE_LEADING.test(commentBody)) {
      pushEscapeHatch(
        comment.start,
        "ts-ignore",
        "`@ts-ignore` silently swallows the next line's type errors forever — use `@ts-expect-error` so the suppression breaks if the underlying error gets fixed",
        "rewrite as `@ts-expect-error <why this is okay>`",
        "high",
        filePath,
        lineStarts,
        results,
      );
      continue;
    }
    if (TS_NOCHECK_LEADING.test(commentBody)) {
      pushEscapeHatch(
        comment.start,
        "ts-nocheck",
        "`@ts-nocheck` disables type checking for the entire file — fix the underlying types or scope the suppression to a specific line",
        "remove `@ts-nocheck` and address the underlying type errors, or use per-line `@ts-expect-error` with a justification",
        "medium",
        filePath,
        lineStarts,
        results,
      );
      continue;
    }
    const expectErrorMatch = commentBody.match(TS_EXPECT_ERROR_LEADING);
    if (expectErrorMatch) {
      const trailingExplanation = (expectErrorMatch[1] ?? "").trim();
      if (trailingExplanation.length === 0) {
        pushEscapeHatch(
          comment.start,
          "ts-expect-error-without-explanation",
          "`@ts-expect-error` should be followed by a comment explaining why the next line legitimately produces a type error",
          "add a short justification: `// @ts-expect-error: <why this is okay>`",
          "low",
          filePath,
          lineStarts,
          results,
        );
      }
    }
  }
};

const pushEscapeHatch = (
  commentStartOffset: number,
  kind: TypeScriptEscapeHatchKind,
  reason: string,
  suggestion: string,
  confidence: TypeScriptEscapeHatch["confidence"],
  filePath: string,
  lineStarts: number[],
  results: TypeScriptEscapeHatch[],
): void => {
  const { line, column } = offsetToLineColumn(commentStartOffset, lineStarts);
  results.push({
    path: filePath,
    kind,
    line,
    column,
    confidence,
    reason,
    suggestion,
  });
};

export interface TypeScriptSmellsResult {
  unnecessaryAssertions: UnnecessaryAssertion[];
  lazyImportsAtTopLevel: LazyImportAtTopLevel[];
  commonjsInEsm: CommonjsInEsm[];
  typeScriptEscapeHatches: TypeScriptEscapeHatch[];
}

const isTypeScriptOrJsFile = (filePath: string): boolean =>
  filePath.endsWith(".ts") ||
  filePath.endsWith(".tsx") ||
  filePath.endsWith(".mts") ||
  filePath.endsWith(".cts") ||
  filePath.endsWith(".js") ||
  filePath.endsWith(".jsx") ||
  filePath.endsWith(".mjs") ||
  filePath.endsWith(".cjs");

const isTypeScriptFileExtension = (filePath: string): boolean =>
  filePath.endsWith(".ts") ||
  filePath.endsWith(".tsx") ||
  filePath.endsWith(".mts") ||
  filePath.endsWith(".cts");

export const detectTypeScriptSmells = (graph: DependencyGraph): TypeScriptSmellsResult => {
  const unnecessaryAssertions: UnnecessaryAssertion[] = [];
  const lazyImportsAtTopLevel: LazyImportAtTopLevel[] = [];
  const commonjsInEsm: CommonjsInEsm[] = [];
  const typeScriptEscapeHatches: TypeScriptEscapeHatch[] = [];

  const packageJsonTypeCache = buildPackageJsonTypeCache();

  for (const module of graph.modules) {
    if (module.isDeclarationFile) continue;
    const filePath = module.fileId.path;
    if (!isTypeScriptOrJsFile(filePath)) continue;

    const parsedSource = parseSource(filePath);
    if (!parsedSource) continue;

    if (isTypeScriptFileExtension(filePath)) {
      visitForUnnecessaryAssertions(
        parsedSource.programNode,
        filePath,
        parsedSource.sourceText,
        parsedSource.lineStarts,
        unnecessaryAssertions,
      );
      collectTypeScriptEscapeHatches(
        parsedSource.comments,
        filePath,
        parsedSource.lineStarts,
        typeScriptEscapeHatches,
      );
    }

    collectLazyImportsAtTopLevel(
      parsedSource.programNode,
      filePath,
      parsedSource.lineStarts,
      lazyImportsAtTopLevel,
    );

    if (isEsmFilePath(filePath, packageJsonTypeCache)) {
      collectCommonjsInEsm(
        parsedSource.programNode,
        filePath,
        parsedSource.sourceText,
        parsedSource.lineStarts,
        commonjsInEsm,
      );
    }
  }

  unnecessaryAssertions.sort((leftFinding, rightFinding) => {
    if (leftFinding.path !== rightFinding.path)
      return leftFinding.path.localeCompare(rightFinding.path);
    return leftFinding.line - rightFinding.line;
  });
  lazyImportsAtTopLevel.sort((leftFinding, rightFinding) => {
    if (leftFinding.path !== rightFinding.path)
      return leftFinding.path.localeCompare(rightFinding.path);
    return leftFinding.line - rightFinding.line;
  });
  commonjsInEsm.sort((leftFinding, rightFinding) => {
    if (leftFinding.path !== rightFinding.path)
      return leftFinding.path.localeCompare(rightFinding.path);
    return leftFinding.line - rightFinding.line;
  });
  typeScriptEscapeHatches.sort((leftFinding, rightFinding) => {
    if (leftFinding.path !== rightFinding.path)
      return leftFinding.path.localeCompare(rightFinding.path);
    return leftFinding.line - rightFinding.line;
  });

  return {
    unnecessaryAssertions,
    lazyImportsAtTopLevel,
    commonjsInEsm,
    typeScriptEscapeHatches,
  };
};
