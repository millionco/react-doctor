import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import { resolveEntryWithExtensions } from "../utils/resolve-entry-with-extensions.js";

const TARO_APP_CONFIG_GLOB = "src/app.config.{ts,tsx,js,jsx,mts,mjs,cts,cjs}";
const TARO_PACKAGE_NAMES = ["@tarojs/cli", "@tarojs/react", "@tarojs/runtime"];

const getPropertyName = (propertyName: ts.PropertyName): string | undefined => {
  if (
    ts.isIdentifier(propertyName) ||
    ts.isStringLiteral(propertyName) ||
    ts.isNoSubstitutionTemplateLiteral(propertyName)
  ) {
    return propertyName.text;
  }
  return undefined;
};

const unwrapConfigExpression = (expression: ts.Expression): ts.Expression => {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    return unwrapConfigExpression(expression.expression);
  }
  if (ts.isCallExpression(expression)) {
    const [configArgument] = expression.arguments;
    return configArgument ? unwrapConfigExpression(configArgument) : expression;
  }
  return expression;
};

const getPropertyInitializer = (
  objectLiteral: ts.ObjectLiteralExpression,
  propertyNames: ReadonlySet<string>,
): ts.Expression | undefined => {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const propertyName = getPropertyName(property.name);
    if (propertyName && propertyNames.has(propertyName)) return property.initializer;
  }
  return undefined;
};

const collectPagePaths = (expression: ts.Expression | undefined): string[] => {
  if (!expression || !ts.isArrayLiteralExpression(expression)) return [];
  return expression.elements.flatMap((element) =>
    ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)
      ? [element.text]
      : [],
  );
};

const resolvePageEntries = (configDirectory: string, pagePaths: ReadonlyArray<string>): string[] =>
  pagePaths.flatMap((pagePath) => {
    const resolvedEntry = resolveEntryWithExtensions(resolve(configDirectory, pagePath));
    return resolvedEntry ? [resolvedEntry] : [];
  });

const collectConfigPageEntries = (
  configDirectory: string,
  configObject: ts.ObjectLiteralExpression,
): string[] => {
  const entries = resolvePageEntries(
    configDirectory,
    collectPagePaths(getPropertyInitializer(configObject, new Set(["pages"]))),
  );
  const subPackagesExpression = getPropertyInitializer(
    configObject,
    new Set(["subPackages", "subpackages"]),
  );
  if (!subPackagesExpression || !ts.isArrayLiteralExpression(subPackagesExpression)) return entries;

  for (const subPackageElement of subPackagesExpression.elements) {
    if (!ts.isObjectLiteralExpression(subPackageElement)) continue;
    const rootExpression = getPropertyInitializer(subPackageElement, new Set(["root"]));
    if (
      !rootExpression ||
      (!ts.isStringLiteral(rootExpression) && !ts.isNoSubstitutionTemplateLiteral(rootExpression))
    ) {
      continue;
    }
    const subPackagePages = collectPagePaths(
      getPropertyInitializer(subPackageElement, new Set(["pages"])),
    ).map((pagePath) => `${rootExpression.text}/${pagePath}`);
    entries.push(...resolvePageEntries(configDirectory, subPackagePages));
  }

  return entries;
};

const extractConfigObject = (sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | undefined => {
  const variableInitializers = new Map<string, ts.Expression>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        variableInitializers.set(declaration.name.text, declaration.initializer);
      }
    }
  }

  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) continue;
    let expression = unwrapConfigExpression(statement.expression);
    const visitedIdentifiers = new Set<string>();
    while (ts.isIdentifier(expression) && !visitedIdentifiers.has(expression.text)) {
      visitedIdentifiers.add(expression.text);
      const initializer = variableInitializers.get(expression.text);
      if (!initializer) break;
      expression = unwrapConfigExpression(initializer);
    }
    if (ts.isObjectLiteralExpression(expression)) return expression;
  }
  return undefined;
};

export const extractTaroPageEntries = (
  directory: string,
  dependencies: Readonly<Record<string, string>>,
): string[] => {
  if (!TARO_PACKAGE_NAMES.some((packageName) => packageName in dependencies)) return [];

  const entries = new Set<string>();
  const configPaths = fg.sync(TARO_APP_CONFIG_GLOB, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
  });
  for (const configPath of configPaths) {
    try {
      const sourceText = readFileSync(configPath, "utf8");
      const sourceFile = ts.createSourceFile(configPath, sourceText, ts.ScriptTarget.Latest, true);
      const configObject = extractConfigObject(sourceFile);
      if (!configObject) continue;
      for (const entry of collectConfigPageEntries(dirname(configPath), configObject)) {
        entries.add(entry);
      }
    } catch {
      continue;
    }
  }
  return [...entries];
};
