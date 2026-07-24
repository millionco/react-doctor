import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { isPlainObject } from "../../project-info/fs-utils.js";
import { failOpenReadJson } from "../../utils/fail-open-read-json.js";
import { unwrapTypescriptExpression } from "../../utils/unwrap-typescript-expression.js";

export interface UnpluginAutoImportGlobalScope {
  readonly directory: string;
  readonly names: ReadonlyArray<string>;
}

export interface CollectUnpluginAutoImportGlobalScopesOptions {
  readonly rootDirectory: string;
  readonly candidateFiles: ReadonlyArray<string>;
}

interface AutoImportConfigGlobalsPaths {
  readonly didFindActiveAutoImport: boolean;
  readonly globalsPaths: ReadonlyArray<string>;
}

const AUTO_IMPORT_ADAPTER_PATTERN =
  /^unplugin-auto-import\/(?:astro|esbuild|rollup|rolldown|rspack|vite|webpack)$/;
const CONFIG_BASENAMES = [
  "astro.config",
  "esbuild.config",
  "rollup.config",
  "rolldown.config",
  "rspack.config",
  "vite.config",
  "webpack.config",
];
const CONFIG_EXTENSIONS = [".cjs", ".cts", ".js", ".mjs", ".mts", ".ts"];
const CONFIG_FILENAMES = new Set(
  CONFIG_BASENAMES.flatMap((basename) =>
    CONFIG_EXTENSIONS.map((extension) => `${basename}${extension}`),
  ),
);
const DEFAULT_ESLINT_GLOBALS_PATH = ".eslintrc-auto-import.json";
const SUPPORTED_GLOBAL_VALUES = new Set([
  true,
  false,
  "readable",
  "readonly",
  "writable",
  "writeable",
]);

const getStaticProperty = (
  objectExpression: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.ObjectLiteralElementLike | null =>
  objectExpression.properties.find((property) => {
    if (ts.isSpreadAssignment(property)) return false;
    const name = ts.isComputedPropertyName(property.name)
      ? unwrapTypescriptExpression(property.name.expression)
      : property.name;
    return (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && name.text === propertyName;
  }) ?? null;

const hasNonLiteralComputedProperty = (objectExpression: ts.ObjectLiteralExpression): boolean =>
  objectExpression.properties.some(
    (property) =>
      !ts.isSpreadAssignment(property) &&
      ts.isComputedPropertyName(property.name) &&
      !ts.isStringLiteralLike(unwrapTypescriptExpression(property.name.expression)),
  );

const getStaticPropertyAssignment = (
  objectExpression: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.PropertyAssignment | null => {
  const property = getStaticProperty(objectExpression, propertyName);
  return property && ts.isPropertyAssignment(property) ? property : null;
};

const getRequireModuleSpecifier = (expression: ts.Expression): string | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (
    ts.isPropertyAccessExpression(unwrappedExpression) &&
    unwrappedExpression.name.text === "default"
  ) {
    return getRequireModuleSpecifier(unwrappedExpression.expression);
  }
  if (
    !ts.isCallExpression(unwrappedExpression) ||
    !ts.isIdentifier(unwrappedExpression.expression) ||
    unwrappedExpression.expression.text !== "require" ||
    unwrappedExpression.arguments.length !== 1
  ) {
    return null;
  }
  const moduleSpecifier = unwrappedExpression.arguments[0];
  return moduleSpecifier && ts.isStringLiteralLike(moduleSpecifier) ? moduleSpecifier.text : null;
};

const getRequiredPropertyModuleSpecifier = (
  expression: ts.Expression,
  propertyName: string,
): string | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  return ts.isPropertyAccessExpression(unwrappedExpression) &&
    unwrappedExpression.name.text === propertyName
    ? getRequireModuleSpecifier(unwrappedExpression.expression)
    : null;
};

const isCommonJsExportAssignment = (node: ts.Node, sourceFile: ts.SourceFile): boolean =>
  ts.isBinaryExpression(node) &&
  node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
  (node.left.getText(sourceFile) === "module.exports" ||
    node.left.getText(sourceFile) === "exports.default");

const isTopLevelExpression = (node: ts.Node): boolean => {
  let ancestor: ts.Node | undefined = node.parent;
  while (ancestor && !ts.isSourceFile(ancestor)) {
    if (ts.isExpressionStatement(ancestor)) return ts.isSourceFile(ancestor.parent);
    if (
      !ts.isParenthesizedExpression(ancestor) &&
      !ts.isAsExpression(ancestor) &&
      !ts.isSatisfiesExpression(ancestor) &&
      !ts.isNonNullExpression(ancestor) &&
      !ts.isTypeAssertionExpression(ancestor) &&
      !ts.isAwaitExpression(ancestor)
    ) {
      return false;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const isInsideActiveConfigProperty = (
  node: ts.Node,
  propertyName: string,
  sourceFile: ts.SourceFile,
  esbuildBindings: ReadonlySet<string>,
  esbuildNamespaceBindings: ReadonlySet<string>,
): boolean => {
  let ancestor: ts.Node | undefined = node.parent;
  let didFindConfigProperty = false;
  while (ancestor && !ts.isSourceFile(ancestor)) {
    if (
      !didFindConfigProperty &&
      !ts.isArrayLiteralExpression(ancestor) &&
      !ts.isParenthesizedExpression(ancestor) &&
      !ts.isAsExpression(ancestor) &&
      !ts.isSatisfiesExpression(ancestor) &&
      !ts.isNonNullExpression(ancestor) &&
      !ts.isTypeAssertionExpression(ancestor) &&
      !ts.isPropertyAssignment(ancestor)
    ) {
      return false;
    }
    if (ts.isPropertyAssignment(ancestor)) {
      const isConfigProperty =
        (ts.isIdentifier(ancestor.name) || ts.isStringLiteralLike(ancestor.name)) &&
        ancestor.name.text === propertyName;
      if (didFindConfigProperty || !isConfigProperty) return false;
      if (
        !ts.isObjectLiteralExpression(ancestor.parent) ||
        ancestor.parent.properties.some(ts.isSpreadAssignment)
      ) {
        return false;
      }
      didFindConfigProperty = true;
      ancestor = ancestor.parent;
      continue;
    }
    if (didFindConfigProperty) {
      if (ts.isExportAssignment(ancestor)) return true;
      if (isCommonJsExportAssignment(ancestor, sourceFile)) {
        return isTopLevelExpression(ancestor);
      }
      if (
        propertyName === "plugins" &&
        ts.isCallExpression(ancestor) &&
        (ts.isIdentifier(ancestor.expression)
          ? esbuildBindings.has(ancestor.expression.text)
          : ts.isPropertyAccessExpression(ancestor.expression) &&
            ancestor.expression.name.text === "build" &&
            ((ts.isIdentifier(ancestor.expression.expression) &&
              esbuildNamespaceBindings.has(ancestor.expression.expression.text)) ||
              getRequireModuleSpecifier(ancestor.expression.expression) === "esbuild"))
      ) {
        return isTopLevelExpression(ancestor);
      }
      const isStaticConfigWrapper =
        ts.isObjectLiteralExpression(ancestor) ||
        ts.isParenthesizedExpression(ancestor) ||
        ts.isAsExpression(ancestor) ||
        ts.isSatisfiesExpression(ancestor) ||
        ts.isNonNullExpression(ancestor) ||
        ts.isTypeAssertionExpression(ancestor) ||
        (ts.isCallExpression(ancestor) &&
          ts.isIdentifier(ancestor.expression) &&
          ancestor.expression.text === "defineConfig");
      if (!isStaticConfigWrapper) {
        return false;
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const getGlobalsPathFromActiveAutoImportCall = (
  callExpression: ts.CallExpression,
  packageDirectory: string,
): string | null => {
  const optionsExpression = callExpression.arguments[0];
  if (!optionsExpression) return null;
  const unwrappedOptions = unwrapTypescriptExpression(optionsExpression);
  if (!ts.isObjectLiteralExpression(unwrappedOptions)) return null;
  if (
    unwrappedOptions.properties.some(ts.isSpreadAssignment) ||
    hasNonLiteralComputedProperty(unwrappedOptions)
  ) {
    return null;
  }
  if (
    getStaticProperty(unwrappedOptions, "include") ||
    getStaticProperty(unwrappedOptions, "exclude")
  ) {
    return null;
  }

  const eslintrcProperty = getStaticPropertyAssignment(unwrappedOptions, "eslintrc");
  if (!eslintrcProperty) return null;
  const eslintrcExpression = unwrapTypescriptExpression(eslintrcProperty.initializer);
  if (!ts.isObjectLiteralExpression(eslintrcExpression)) return null;
  if (
    eslintrcExpression.properties.some(ts.isSpreadAssignment) ||
    hasNonLiteralComputedProperty(eslintrcExpression)
  ) {
    return null;
  }

  const enabledProperty = getStaticPropertyAssignment(eslintrcExpression, "enabled");
  if (
    !enabledProperty ||
    unwrapTypescriptExpression(enabledProperty.initializer).kind !== ts.SyntaxKind.TrueKeyword
  ) {
    return null;
  }

  const filepathProperty = getStaticProperty(eslintrcExpression, "filepath");
  if (!filepathProperty) return path.join(packageDirectory, DEFAULT_ESLINT_GLOBALS_PATH);
  if (!ts.isPropertyAssignment(filepathProperty)) return null;
  const filepathExpression = unwrapTypescriptExpression(filepathProperty.initializer);
  return ts.isStringLiteralLike(filepathExpression)
    ? path.resolve(packageDirectory, filepathExpression.text)
    : null;
};

const collectGlobalsPathsFromConfig = (
  configPath: string,
  packageDirectory: string,
): AutoImportConfigGlobalsPaths => {
  let sourceText: string;
  try {
    sourceText = fs.readFileSync(configPath, "utf8");
  } catch {
    return { didFindActiveAutoImport: false, globalsPaths: [] };
  }

  const sourceFile = ts.createSourceFile(configPath, sourceText, ts.ScriptTarget.Latest, true);
  const autoImportBindings = new Map<string, string>();
  const esbuildBindings = new Set<string>();
  const esbuildNamespaceBindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const moduleSpecifier = statement.moduleSpecifier.text;
      if (AUTO_IMPORT_ADAPTER_PATTERN.test(moduleSpecifier)) {
        const defaultBinding = statement.importClause?.name;
        if (defaultBinding) autoImportBindings.set(defaultBinding.text, moduleSpecifier);
      }
      if (moduleSpecifier === "esbuild") {
        const defaultBinding = statement.importClause?.name;
        if (defaultBinding) esbuildNamespaceBindings.add(defaultBinding.text);
        const namedBindings = statement.importClause?.namedBindings;
        if (namedBindings && ts.isNamedImports(namedBindings)) {
          for (const importSpecifier of namedBindings.elements) {
            if ((importSpecifier.propertyName ?? importSpecifier.name).text === "build") {
              esbuildBindings.add(importSpecifier.name.text);
            }
          }
        }
        if (namedBindings && ts.isNamespaceImport(namedBindings)) {
          esbuildNamespaceBindings.add(namedBindings.name.text);
        }
      }
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue;
      const declarationName = ts.isIdentifier(declaration.name) ? declaration.name.text : null;
      const moduleSpecifier = getRequireModuleSpecifier(declaration.initializer);
      if (declarationName && moduleSpecifier && AUTO_IMPORT_ADAPTER_PATTERN.test(moduleSpecifier)) {
        autoImportBindings.set(declarationName, moduleSpecifier);
      }
      if (moduleSpecifier === "esbuild") {
        if (declarationName) {
          esbuildNamespaceBindings.add(declarationName);
        }
        if (ts.isObjectBindingPattern(declaration.name)) {
          for (const bindingElement of declaration.name.elements) {
            const importedName = bindingElement.propertyName ?? bindingElement.name;
            if (
              ts.isIdentifier(importedName) &&
              importedName.text === "build" &&
              ts.isIdentifier(bindingElement.name)
            ) {
              esbuildBindings.add(bindingElement.name.text);
            }
          }
        }
      }
      if (
        declarationName &&
        getRequiredPropertyModuleSpecifier(declaration.initializer, "build") === "esbuild"
      ) {
        esbuildBindings.add(declarationName);
      }
    }
  }

  const globalsPaths = new Set<string>();
  let didFindActiveAutoImport = false;
  let didFindUnsafeActiveAutoImport = false;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const moduleSpecifier = ts.isIdentifier(node.expression)
        ? autoImportBindings.get(node.expression.text)
        : getRequireModuleSpecifier(node.expression);
      if (moduleSpecifier && AUTO_IMPORT_ADAPTER_PATTERN.test(moduleSpecifier)) {
        const propertyName = moduleSpecifier.endsWith("/astro") ? "integrations" : "plugins";
        const isActive = isInsideActiveConfigProperty(
          node,
          propertyName,
          sourceFile,
          esbuildBindings,
          esbuildNamespaceBindings,
        );
        if (isActive) {
          didFindActiveAutoImport = true;
          const globalsPath = getGlobalsPathFromActiveAutoImportCall(node, packageDirectory);
          if (globalsPath) {
            globalsPaths.add(globalsPath);
          } else {
            didFindUnsafeActiveAutoImport = true;
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return {
    didFindActiveAutoImport,
    globalsPaths: didFindUnsafeActiveAutoImport ? [] : [...globalsPaths],
  };
};

const collectGeneratedGlobalNames = (
  globalsPath: string,
  rootDirectory: string,
): ReadonlyArray<string> => {
  const relativePath = path.relative(rootDirectory, globalsPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) return [];

  const parsed = failOpenReadJson<unknown>(globalsPath, null);
  if (!isPlainObject(parsed) || !isPlainObject(parsed.globals)) return [];
  return Object.entries(parsed.globals)
    .filter(
      (entry): entry is [string, boolean | string] =>
        entry[0].length > 0 &&
        (typeof entry[1] === "boolean" || typeof entry[1] === "string") &&
        SUPPORTED_GLOBAL_VALUES.has(entry[1]),
    )
    .map(([name]) => name)
    .sort();
};

const findOwningPackageDirectory = (
  absoluteFilePath: string,
  rootDirectory: string,
  cache: Map<string, string | null>,
): string | null => {
  let currentDirectory = path.dirname(absoluteFilePath);
  const visitedDirectories: string[] = [];
  while (true) {
    const cachedDirectory = cache.get(currentDirectory);
    if (cachedDirectory !== undefined) {
      for (const visitedDirectory of visitedDirectories) {
        cache.set(visitedDirectory, cachedDirectory);
      }
      return cachedDirectory;
    }

    const relativeDirectory = path.relative(rootDirectory, currentDirectory);
    if (relativeDirectory.startsWith("..") || path.isAbsolute(relativeDirectory)) {
      for (const visitedDirectory of visitedDirectories) cache.set(visitedDirectory, null);
      return null;
    }
    visitedDirectories.push(currentDirectory);
    if (fs.existsSync(path.join(currentDirectory, "package.json"))) {
      for (const visitedDirectory of visitedDirectories) {
        cache.set(visitedDirectory, currentDirectory);
      }
      return currentDirectory;
    }
    if (currentDirectory === rootDirectory) {
      for (const visitedDirectory of visitedDirectories) cache.set(visitedDirectory, null);
      return null;
    }
    currentDirectory = path.dirname(currentDirectory);
  }
};

const collectPackageGlobalNames = (
  packageDirectory: string,
  rootDirectory: string,
): ReadonlyArray<string> => {
  let directoryEntries: fs.Dirent[];
  try {
    directoryEntries = fs.readdirSync(packageDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  const configuredGlobalsPaths: string[][] = [];
  for (const entry of directoryEntries) {
    if ((!entry.isFile() && !entry.isSymbolicLink()) || !CONFIG_FILENAMES.has(entry.name)) {
      continue;
    }
    const configPath = path.join(packageDirectory, entry.name);
    const configGlobalsPaths = collectGlobalsPathsFromConfig(configPath, packageDirectory);
    if (configGlobalsPaths.didFindActiveAutoImport) {
      configuredGlobalsPaths.push(configGlobalsPaths.globalsPaths.toSorted());
    }
  }
  if (configuredGlobalsPaths.length === 0) return [];
  const globalsPaths = configuredGlobalsPaths[0];
  if (
    configuredGlobalsPaths.some(
      (candidatePaths) =>
        candidatePaths.length !== globalsPaths.length ||
        candidatePaths.some((candidatePath, index) => candidatePath !== globalsPaths[index]),
    )
  ) {
    return [];
  }

  const names = new Set<string>();
  for (const globalsPath of globalsPaths) {
    for (const name of collectGeneratedGlobalNames(globalsPath, rootDirectory)) names.add(name);
  }
  return [...names].sort();
};

export const collectUnpluginAutoImportGlobalScopes = ({
  rootDirectory,
  candidateFiles,
}: CollectUnpluginAutoImportGlobalScopesOptions): ReadonlyArray<UnpluginAutoImportGlobalScope> => {
  const absoluteRootDirectory = path.resolve(rootDirectory);
  const packageDirectoryCache = new Map<string, string | null>();
  const packageDirectories = new Set<string>();
  for (const candidateFile of candidateFiles) {
    const packageDirectory = findOwningPackageDirectory(
      path.resolve(absoluteRootDirectory, candidateFile),
      absoluteRootDirectory,
      packageDirectoryCache,
    );
    if (packageDirectory) packageDirectories.add(packageDirectory);
  }

  const scopes = [...packageDirectories]
    .map((packageDirectory) => ({
      directory: path.relative(absoluteRootDirectory, packageDirectory).replaceAll("\\", "/"),
      names: collectPackageGlobalNames(packageDirectory, absoluteRootDirectory),
    }))
    .sort((firstScope, secondScope) => firstScope.directory.localeCompare(secondScope.directory));
  return scopes.some((scope) => scope.names.length > 0) ? scopes : [];
};
