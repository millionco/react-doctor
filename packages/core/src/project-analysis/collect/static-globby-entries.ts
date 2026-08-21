import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import { unwrapTypescriptExpression as unwrapExpression } from "../../utils/unwrap-typescript-expression.js";
import { DEFAULT_EXTENSIONS } from "../constants.js";
import { isPathInsideDirectoryOrEqual } from "../utils/is-path-inside-directory-or-equal.js";

interface GlobbyAnalysisContext {
  entryFilePath: string;
  projectRoot: string;
  sourceFile: ts.SourceFile;
  variableDeclarations: ReadonlyMap<string, ts.Expression>;
}

const getCalledName = (expression: ts.LeftHandSideExpression): string | undefined => {
  const unwrappedExpression = unwrapExpression(expression);
  if (ts.isIdentifier(unwrappedExpression)) return unwrappedExpression.text;
  if (ts.isPropertyAccessExpression(unwrappedExpression)) return unwrappedExpression.name.text;
  return undefined;
};

const isImportMetaUrl = (expression: ts.Expression): boolean => {
  const unwrappedExpression = unwrapExpression(expression);
  return (
    ts.isPropertyAccessExpression(unwrappedExpression) &&
    unwrappedExpression.name.text === "url" &&
    ts.isMetaProperty(unwrappedExpression.expression) &&
    unwrappedExpression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  );
};

const evaluateDirectoryExpression = (
  expression: ts.Expression,
  context: GlobbyAnalysisContext,
  seenIdentifiers = new Set<string>(),
): string | undefined => {
  const unwrappedExpression = unwrapExpression(expression);
  if (ts.isStringLiteralLike(unwrappedExpression)) {
    return resolve(dirname(context.entryFilePath), unwrappedExpression.text);
  }
  if (ts.isIdentifier(unwrappedExpression)) {
    if (unwrappedExpression.text === "__dirname") return dirname(context.entryFilePath);
    if (seenIdentifiers.has(unwrappedExpression.text)) return undefined;
    const initializer = context.variableDeclarations.get(unwrappedExpression.text);
    if (!initializer) return undefined;
    const nextSeenIdentifiers = new Set(seenIdentifiers);
    nextSeenIdentifiers.add(unwrappedExpression.text);
    return evaluateDirectoryExpression(initializer, context, nextSeenIdentifiers);
  }
  if (
    ts.isPropertyAccessExpression(unwrappedExpression) &&
    unwrappedExpression.name.text === "dirname" &&
    ts.isMetaProperty(unwrappedExpression.expression) &&
    unwrappedExpression.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  ) {
    return dirname(context.entryFilePath);
  }
  if (!ts.isCallExpression(unwrappedExpression)) return undefined;

  const calledName = getCalledName(unwrappedExpression.expression);
  if (
    calledName === "cwd" &&
    ts.isPropertyAccessExpression(unwrappedExpression.expression) &&
    ts.isIdentifier(unwrappedExpression.expression.expression) &&
    unwrappedExpression.expression.expression.text === "process"
  ) {
    return context.projectRoot;
  }
  if (
    calledName === "fileURLToPath" &&
    unwrappedExpression.arguments[0] &&
    isImportMetaUrl(unwrappedExpression.arguments[0])
  ) {
    return context.entryFilePath;
  }
  if (calledName === "dirname" && unwrappedExpression.arguments[0]) {
    const evaluatedPath = evaluateDirectoryExpression(
      unwrappedExpression.arguments[0],
      context,
      seenIdentifiers,
    );
    return evaluatedPath ? dirname(evaluatedPath) : undefined;
  }
  if (calledName !== "join" && calledName !== "resolve") return undefined;

  const [baseExpression, ...segmentExpressions] = unwrappedExpression.arguments;
  if (!baseExpression) return undefined;
  const baseDirectory = evaluateDirectoryExpression(baseExpression, context, seenIdentifiers);
  if (!baseDirectory) return undefined;
  const pathSegments: string[] = [];
  for (const segmentExpression of segmentExpressions) {
    const unwrappedSegment = unwrapExpression(segmentExpression);
    if (!ts.isStringLiteralLike(unwrappedSegment)) return undefined;
    pathSegments.push(unwrappedSegment.text);
  }
  return calledName === "join"
    ? join(baseDirectory, ...pathSegments)
    : resolve(baseDirectory, ...pathSegments);
};

const collectStaticPatterns = (expression: ts.Expression): string[] => {
  const unwrappedExpression = unwrapExpression(expression);
  if (ts.isStringLiteralLike(unwrappedExpression)) return [unwrappedExpression.text];
  if (!ts.isArrayLiteralExpression(unwrappedExpression)) return [];
  const patterns: string[] = [];
  for (const element of unwrappedExpression.elements) {
    const unwrappedElement = unwrapExpression(element);
    if (!ts.isStringLiteralLike(unwrappedElement)) return [];
    patterns.push(unwrappedElement.text);
  }
  return patterns;
};

const findCwdExpression = (expression: ts.Expression | undefined): ts.Expression | undefined => {
  if (!expression) return undefined;
  const unwrappedExpression = unwrapExpression(expression);
  if (!ts.isObjectLiteralExpression(unwrappedExpression)) return undefined;
  for (const property of unwrappedExpression.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName =
      ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
        ? property.name.text
        : undefined;
    if (propertyName === "cwd") return property.initializer;
  }
  return undefined;
};

const collectGlobbyLocalNames = (sourceFile: ts.SourceFile): Set<string> => {
  const localNames = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "globby" ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }
    for (const element of statement.importClause.namedBindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      if (importedName === "globby" || importedName === "globbySync") {
        localNames.add(element.name.text);
      }
    }
  }
  return localNames;
};

const collectVariableDeclarations = (sourceFile: ts.SourceFile): Map<string, ts.Expression> => {
  const declarations = new Map<string, ts.Expression>();
  const visitNode = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sourceFile);
  return declarations;
};

const extractGlobbyEntriesFromFile = (entryFilePath: string, projectRoot: string): string[] => {
  if (!existsSync(entryFilePath)) return [];
  let sourceText: string;
  try {
    sourceText = readFileSync(entryFilePath, "utf8");
  } catch {
    return [];
  }
  if (!sourceText.includes("globby")) return [];

  const sourceFile = ts.createSourceFile(
    entryFilePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const globbyLocalNames = collectGlobbyLocalNames(sourceFile);
  if (globbyLocalNames.size === 0) return [];
  const context: GlobbyAnalysisContext = {
    entryFilePath,
    projectRoot,
    sourceFile,
    variableDeclarations: collectVariableDeclarations(sourceFile),
  };
  const entries = new Set<string>();

  const visitNode = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(unwrapExpression(node.expression)) &&
      globbyLocalNames.has(unwrapExpression(node.expression).getText()) &&
      node.arguments[0]
    ) {
      const patterns = collectStaticPatterns(node.arguments[0]);
      const cwdExpression = findCwdExpression(node.arguments[1]);
      const workingDirectory = cwdExpression
        ? evaluateDirectoryExpression(cwdExpression, context)
        : dirname(entryFilePath);
      if (
        patterns.length > 0 &&
        workingDirectory &&
        isPathInsideDirectoryOrEqual(workingDirectory, projectRoot)
      ) {
        for (const filePath of fg.sync(patterns, {
          cwd: workingDirectory,
          absolute: true,
          onlyFiles: true,
          ignore: ["**/node_modules/**"],
        })) {
          if (
            isPathInsideDirectoryOrEqual(filePath, projectRoot) &&
            DEFAULT_EXTENSIONS.some((extension) => filePath.endsWith(extension))
          ) {
            entries.add(filePath);
          }
        }
      }
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sourceFile);
  return [...entries];
};

export const extractStaticGlobbyEntries = (
  entryFilePaths: ReadonlyArray<string>,
  projectRoot: string,
): string[] => {
  const entries = new Set<string>();
  for (const entryFilePath of entryFilePaths) {
    for (const globbyEntry of extractGlobbyEntriesFromFile(entryFilePath, projectRoot)) {
      entries.add(globbyEntry);
    }
  }
  return [...entries];
};
