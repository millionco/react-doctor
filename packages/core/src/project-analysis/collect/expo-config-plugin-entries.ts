import { readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import fg from "fast-glob";
import ts from "typescript";
import { EXPO_CONFIG_SCAN_MAX_DEPTH, SOURCE_EXTENSIONS } from "../constants.js";

const EXPO_CONFIG_FILE_GLOBS = ["app.config.{ts,mts,cts,js,mjs,cjs}", "app.json"];
const NESTED_EXPO_CONFIG_FILE_GLOBS = [
  ...EXPO_CONFIG_FILE_GLOBS,
  "**/app.config.{ts,mts,cts,js,mjs,cjs}",
  "**/app.json",
];

const EXPO_REACT_NATIVE_DEPENDENCIES = new Set(["expo", "react-native"]);

const EXPO_PLUGIN_RESOLVABLE_EXTENSIONS = SOURCE_EXTENSIONS.map(
  (sourceExtension) => `.${sourceExtension}`,
);

interface StaticConfigBindings {
  readonly expressions: Map<string, ts.Expression>;
  readonly functions: Map<string, ts.FunctionDeclaration>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isExpoOrReactNativeWorkspace = (dependencies: Record<string, string>): boolean =>
  [...EXPO_REACT_NATIVE_DEPENDENCIES].some((dependencyName) => dependencyName in dependencies);

const isLocalExpoPluginPath = (value: string): boolean =>
  (value.startsWith("./") || value.startsWith("../")) &&
  !value.includes("*") &&
  !value.includes("?");

const isFile = (filePath: string): boolean => {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
};

const resolveExpoPluginPath = (configDirectory: string, pluginPath: string): string | undefined => {
  const candidatePath = resolve(configDirectory, pluginPath);
  if (isFile(candidatePath)) return candidatePath;

  for (const extension of EXPO_PLUGIN_RESOLVABLE_EXTENSIONS) {
    const candidatePathWithExtension = `${candidatePath}${extension}`;
    if (isFile(candidatePathWithExtension)) return candidatePathWithExtension;
  }

  for (const extension of EXPO_PLUGIN_RESOLVABLE_EXTENSIONS) {
    const indexCandidatePath = join(candidatePath, `index${extension}`);
    if (isFile(indexCandidatePath)) return indexCandidatePath;
  }

  return undefined;
};

const addExpoPluginEntry = (
  entries: Set<string>,
  packageNamePlugins: Set<string>,
  rootDirectory: string,
  configDirectory: string,
  pluginPath: string,
): void => {
  if (!isLocalExpoPluginPath(pluginPath)) {
    packageNamePlugins.add(pluginPath);
    return;
  }

  const resolvedPath = resolveExpoPluginPath(configDirectory, pluginPath);
  if (!resolvedPath) return;

  const relativePath = relative(rootDirectory, resolvedPath);
  if (relativePath !== "" && (relativePath.startsWith("..") || isAbsolute(relativePath))) return;

  entries.add(resolvedPath);
};

const getPropertyName = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))
    return name.text;
  return undefined;
};

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  let currentExpression = expression;
  while (ts.isParenthesizedExpression(currentExpression)) {
    currentExpression = currentExpression.expression;
  }
  return currentExpression;
};

const collectExpoPluginPathsFromArray = (
  array: ts.ArrayLiteralExpression,
  entries: Set<string>,
  packageNamePlugins: Set<string>,
  rootDirectory: string,
  configDirectory: string,
): void => {
  for (const element of array.elements) {
    if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
      addExpoPluginEntry(entries, packageNamePlugins, rootDirectory, configDirectory, element.text);
      continue;
    }

    if (ts.isArrayLiteralExpression(element)) {
      const [pluginName] = element.elements;
      if (
        pluginName &&
        (ts.isStringLiteral(pluginName) || ts.isNoSubstitutionTemplateLiteral(pluginName))
      ) {
        addExpoPluginEntry(
          entries,
          packageNamePlugins,
          rootDirectory,
          configDirectory,
          pluginName.text,
        );
      }
    }
  }
};

const collectExpoPluginPathsFromConfigObject = (
  objectLiteral: ts.ObjectLiteralExpression,
  entries: Set<string>,
  packageNamePlugins: Set<string>,
  rootDirectory: string,
  configDirectory: string,
): void => {
  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) continue;

    const propertyName = getPropertyName(property.name);
    if (propertyName === "plugins" && ts.isArrayLiteralExpression(property.initializer)) {
      collectExpoPluginPathsFromArray(
        property.initializer,
        entries,
        packageNamePlugins,
        rootDirectory,
        configDirectory,
      );
    }

    if (propertyName === "expo" && ts.isObjectLiteralExpression(property.initializer)) {
      collectExpoPluginPathsFromConfigObject(
        property.initializer,
        entries,
        packageNamePlugins,
        rootDirectory,
        configDirectory,
      );
    }
  }
};

const collectReturnedExpoConfigPluginPaths = (
  body: ts.ConciseBody,
  entries: Set<string>,
  packageNamePlugins: Set<string>,
  rootDirectory: string,
  configDirectory: string,
): void => {
  if (!ts.isBlock(body)) {
    const expression = unwrapExpression(body);
    if (ts.isObjectLiteralExpression(expression)) {
      collectExpoPluginPathsFromConfigObject(
        expression,
        entries,
        packageNamePlugins,
        rootDirectory,
        configDirectory,
      );
    }
    return;
  }

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node))
      return;

    if (ts.isReturnStatement(node) && node.expression) {
      const expression = unwrapExpression(node.expression);
      if (ts.isObjectLiteralExpression(expression)) {
        collectExpoPluginPathsFromConfigObject(
          expression,
          entries,
          packageNamePlugins,
          rootDirectory,
          configDirectory,
        );
      }
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(body);
};

const collectExpoPluginPathsFromConfigExpression = (
  expression: ts.Expression,
  entries: Set<string>,
  packageNamePlugins: Set<string>,
  rootDirectory: string,
  configDirectory: string,
  bindings: StaticConfigBindings,
  seenIdentifiers = new Set<string>(),
): void => {
  const configExpression = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(configExpression)) {
    collectExpoPluginPathsFromConfigObject(
      configExpression,
      entries,
      packageNamePlugins,
      rootDirectory,
      configDirectory,
    );
    return;
  }

  if (ts.isIdentifier(configExpression)) {
    if (seenIdentifiers.has(configExpression.text)) return;

    seenIdentifiers.add(configExpression.text);
    const boundExpression = bindings.expressions.get(configExpression.text);
    if (boundExpression) {
      collectExpoPluginPathsFromConfigExpression(
        boundExpression,
        entries,
        packageNamePlugins,
        rootDirectory,
        configDirectory,
        bindings,
        seenIdentifiers,
      );
      return;
    }

    const boundFunction = bindings.functions.get(configExpression.text);
    if (boundFunction?.body) {
      collectReturnedExpoConfigPluginPaths(
        boundFunction.body,
        entries,
        packageNamePlugins,
        rootDirectory,
        configDirectory,
      );
    }
    return;
  }

  if (ts.isArrowFunction(configExpression)) {
    collectReturnedExpoConfigPluginPaths(
      configExpression.body,
      entries,
      packageNamePlugins,
      rootDirectory,
      configDirectory,
    );
    return;
  }

  if (ts.isFunctionExpression(configExpression) && configExpression.body) {
    collectReturnedExpoConfigPluginPaths(
      configExpression.body,
      entries,
      packageNamePlugins,
      rootDirectory,
      configDirectory,
    );
  }
};

const hasDefaultExportModifier = (node: ts.Node): boolean =>
  Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
  );

const isModuleExportsAssignmentTarget = (node: ts.Node): boolean =>
  ts.isPropertyAccessExpression(node) &&
  ts.isIdentifier(node.expression) &&
  node.expression.text === "module" &&
  node.name.text === "exports";

const collectStaticConfigBindings = (sourceFile: ts.SourceFile): StaticConfigBindings => {
  const expressions = new Map<string, ts.Expression>();
  const functions = new Map<string, ts.FunctionDeclaration>();

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          expressions.set(declaration.name.text, declaration.initializer);
        }
      }
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    }
  }

  return { expressions, functions };
};

const collectExpoPluginPathsFromAppConfig = (
  configPath: string,
  entries: Set<string>,
  packageNamePlugins: Set<string>,
  rootDirectory: string,
): void => {
  const extension = extname(configPath);
  const sourceFile = ts.createSourceFile(
    configPath,
    readFileSync(configPath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    extension === ".ts" || extension === ".mts" || extension === ".cts"
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JS,
  );
  const configDirectory = dirname(configPath);
  const bindings = collectStaticConfigBindings(sourceFile);

  const visit = (node: ts.Node): void => {
    if (ts.isExportAssignment(node)) {
      collectExpoPluginPathsFromConfigExpression(
        node.expression,
        entries,
        packageNamePlugins,
        rootDirectory,
        configDirectory,
        bindings,
      );
      return;
    }

    if (ts.isFunctionDeclaration(node) && hasDefaultExportModifier(node) && node.body) {
      collectReturnedExpoConfigPluginPaths(
        node.body,
        entries,
        packageNamePlugins,
        rootDirectory,
        configDirectory,
      );
      return;
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isModuleExportsAssignmentTarget(node.left)
    ) {
      collectExpoPluginPathsFromConfigExpression(
        node.right,
        entries,
        packageNamePlugins,
        rootDirectory,
        configDirectory,
        bindings,
      );
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
};

const collectPluginPathsFromJsonValue = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];

  const pluginPaths: string[] = [];
  for (const plugin of value) {
    if (typeof plugin === "string") {
      pluginPaths.push(plugin);
      continue;
    }

    if (Array.isArray(plugin) && typeof plugin[0] === "string") pluginPaths.push(plugin[0]);
  }

  return pluginPaths;
};

const collectExpoPluginPathsFromAppJson = (
  configPath: string,
  entries: Set<string>,
  packageNamePlugins: Set<string>,
  rootDirectory: string,
): void => {
  const parsedJson: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  const configDirectory = dirname(configPath);
  if (!isRecord(parsedJson)) return;

  const expoConfig = parsedJson.expo;
  const expoPluginPaths = isRecord(expoConfig)
    ? collectPluginPathsFromJsonValue(expoConfig.plugins)
    : [];

  for (const pluginPath of [
    ...expoPluginPaths,
    ...collectPluginPathsFromJsonValue(parsedJson.plugins),
  ]) {
    addExpoPluginEntry(entries, packageNamePlugins, rootDirectory, configDirectory, pluginPath);
  }
};

const collectExpoPluginPathsFromConfig = (
  configPath: string,
  entries: Set<string>,
  packageNamePlugins: Set<string>,
  rootDirectory: string,
): void => {
  try {
    if (basename(configPath) === "app.json") {
      collectExpoPluginPathsFromAppJson(configPath, entries, packageNamePlugins, rootDirectory);
      return;
    }

    collectExpoPluginPathsFromAppConfig(configPath, entries, packageNamePlugins, rootDirectory);
  } catch {}
};

interface ExpoConfigPluginCollection {
  readonly filePaths: string[];
  readonly packageNames: string[];
}

export const extractExpoConfigPluginEntries = (
  directory: string,
  dependencies: Record<string, string>,
  rootDirectory = directory,
  includeNestedConfigs = true,
): ExpoConfigPluginCollection => {
  if (!isExpoOrReactNativeWorkspace(dependencies)) return { filePaths: [], packageNames: [] };

  const entries = new Set<string>();
  const packageNamePlugins = new Set<string>();
  const configPaths = fg.sync(
    includeNestedConfigs ? NESTED_EXPO_CONFIG_FILE_GLOBS : EXPO_CONFIG_FILE_GLOBS,
    {
      cwd: directory,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
      deep: EXPO_CONFIG_SCAN_MAX_DEPTH,
    },
  );

  for (const configPath of configPaths) {
    collectExpoPluginPathsFromConfig(configPath, entries, packageNamePlugins, rootDirectory);
  }

  return { filePaths: [...entries], packageNames: [...packageNamePlugins] };
};
