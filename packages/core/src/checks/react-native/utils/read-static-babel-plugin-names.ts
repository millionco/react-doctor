import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { isFile, isPlainObject, readPackageJson } from "../../../project-info/index.js";
import { getTypescriptScriptKind } from "../../../utils/get-typescript-script-kind.js";
import { unwrapTypescriptExpression } from "../../../utils/unwrap-typescript-expression.js";

const BABEL_CONFIG_FILE_NAMES: ReadonlyArray<string> = [
  "babel.config.js",
  "babel.config.cjs",
  "babel.config.mjs",
  "babel.config.ts",
  "babel.config.cts",
  "babel.config.json",
  ".babelrc",
  ".babelrc.js",
  ".babelrc.cjs",
  ".babelrc.mjs",
  ".babelrc.cts",
  ".babelrc.json",
];

export interface StaticBabelPluginNames {
  readonly filePath: string;
  readonly pluginNames: ReadonlyArray<string> | null;
}

const readUnknownPluginNames = (value: unknown): ReadonlyArray<string> | null => {
  if (!Array.isArray(value)) return null;

  const pluginNames: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      pluginNames.push(entry);
      continue;
    }
    if (Array.isArray(entry) && typeof entry[0] === "string") {
      pluginNames.push(entry[0]);
      continue;
    }
    return null;
  }
  return pluginNames;
};

const getStaticPropertyName = (propertyName: ts.PropertyName): string | null => {
  if (ts.isIdentifier(propertyName) || ts.isStringLiteralLike(propertyName)) {
    return propertyName.text;
  }
  return null;
};

const getStaticPluginName = (expression: ts.Expression): string | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (ts.isStringLiteralLike(unwrappedExpression)) return unwrappedExpression.text;
  if (!ts.isArrayLiteralExpression(unwrappedExpression)) return null;
  const pluginExpression = unwrappedExpression.elements[0];
  return pluginExpression && ts.isStringLiteralLike(pluginExpression)
    ? pluginExpression.text
    : null;
};

const getPluginNamesFromObject = (
  objectExpression: ts.ObjectLiteralExpression,
): ReadonlyArray<string> | null => {
  if (objectExpression.properties.some((property) => ts.isSpreadAssignment(property))) return null;

  const pluginProperties = objectExpression.properties.filter(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && getStaticPropertyName(property.name) === "plugins",
  );
  if (pluginProperties.length !== 1) return pluginProperties.length === 0 ? [] : null;

  const pluginListExpression = unwrapTypescriptExpression(pluginProperties[0].initializer);
  if (!ts.isArrayLiteralExpression(pluginListExpression)) return null;

  const pluginNames: string[] = [];
  for (const element of pluginListExpression.elements) {
    if (ts.isSpreadElement(element)) return null;
    const pluginName = getStaticPluginName(element);
    if (pluginName === null) return null;
    pluginNames.push(pluginName);
  }
  return pluginNames;
};

const isModuleExports = (expression: ts.Expression): boolean =>
  (ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "module" &&
    expression.name.text === "exports") ||
  (ts.isElementAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "module" &&
    expression.argumentExpression !== undefined &&
    ts.isStringLiteralLike(expression.argumentExpression) &&
    expression.argumentExpression.text === "exports");

const getDirectExportedObject = (sourceFile: ts.SourceFile): ts.ObjectLiteralExpression | null => {
  const exportedExpressions: ts.Expression[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isExportAssignment(statement)) {
      exportedExpressions.push(statement.expression);
      continue;
    }
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression) &&
      statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isModuleExports(statement.expression.left)
    ) {
      exportedExpressions.push(statement.expression.right);
    }
  }
  if (exportedExpressions.length !== 1) return null;
  const exportedExpression = unwrapTypescriptExpression(exportedExpressions[0]);
  return ts.isObjectLiteralExpression(exportedExpression) ? exportedExpression : null;
};

const parseConfigPluginNames = (
  filePath: string,
  contents: string,
): ReadonlyArray<string> | null => {
  try {
    const parsedJson: unknown = JSON.parse(contents);
    return isPlainObject(parsedJson) ? readUnknownPluginNames(parsedJson.plugins) : null;
  } catch {
    const transpileResult = ts.transpileModule(contents, {
      fileName: filePath,
      reportDiagnostics: true,
      compilerOptions: { allowJs: true },
    });
    if (
      transpileResult.diagnostics?.some(
        (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
      )
    ) {
      return null;
    }
    const sourceFile = ts.createSourceFile(
      filePath,
      contents,
      ts.ScriptTarget.Latest,
      true,
      getTypescriptScriptKind(filePath),
    );
    const exportedObject = getDirectExportedObject(sourceFile);
    return exportedObject === null ? null : getPluginNamesFromObject(exportedObject);
  }
};

export const readStaticBabelPluginNames = (
  rootDirectory: string,
): StaticBabelPluginNames | null => {
  for (const fileName of BABEL_CONFIG_FILE_NAMES) {
    const absoluteFilePath = path.join(rootDirectory, fileName);
    if (!isFile(absoluteFilePath)) continue;
    try {
      return {
        filePath: fileName,
        pluginNames: parseConfigPluginNames(fileName, fs.readFileSync(absoluteFilePath, "utf-8")),
      };
    } catch {
      return { filePath: fileName, pluginNames: null };
    }
  }

  const packageJson = readPackageJson(path.join(rootDirectory, "package.json"));
  if (!isPlainObject(packageJson.babel)) return null;
  return {
    filePath: "package.json",
    pluginNames: readUnknownPluginNames(packageJson.babel.plugins),
  };
};
