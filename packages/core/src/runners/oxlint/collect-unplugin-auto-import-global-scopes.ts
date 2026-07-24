import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { isPlainObject } from "../../project-info/index.js";
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

const getStaticPropertyAssignment = (
  objectExpression: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.PropertyAssignment | null =>
  objectExpression.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) &&
      property.name.text === propertyName,
  ) ?? null;

const isInsideExportedPluginsProperty = (node: ts.Node): boolean => {
  let ancestor: ts.Node | undefined = node.parent;
  let didFindPluginsProperty = false;
  while (ancestor && !ts.isSourceFile(ancestor)) {
    if (
      ts.isPropertyAssignment(ancestor) &&
      (ts.isIdentifier(ancestor.name) || ts.isStringLiteralLike(ancestor.name)) &&
      ancestor.name.text === "plugins"
    ) {
      didFindPluginsProperty = true;
    }
    if (didFindPluginsProperty && ts.isExportAssignment(ancestor)) return true;
    ancestor = ancestor.parent;
  }
  return false;
};

const getGlobalsPathFromAutoImportCall = (
  callExpression: ts.CallExpression,
  packageDirectory: string,
): string | null => {
  if (!isInsideExportedPluginsProperty(callExpression)) return null;
  const optionsExpression = callExpression.arguments[0];
  if (!optionsExpression) return null;
  const unwrappedOptions = unwrapTypescriptExpression(optionsExpression);
  if (!ts.isObjectLiteralExpression(unwrappedOptions)) return null;
  if (
    getStaticPropertyAssignment(unwrappedOptions, "include") ||
    getStaticPropertyAssignment(unwrappedOptions, "exclude") ||
    getStaticPropertyAssignment(unwrappedOptions, "ignore")
  ) {
    return null;
  }

  const eslintrcProperty = getStaticPropertyAssignment(unwrappedOptions, "eslintrc");
  if (!eslintrcProperty) return null;
  const eslintrcExpression = unwrapTypescriptExpression(eslintrcProperty.initializer);
  if (!ts.isObjectLiteralExpression(eslintrcExpression)) return null;

  const enabledProperty = getStaticPropertyAssignment(eslintrcExpression, "enabled");
  if (
    !enabledProperty ||
    unwrapTypescriptExpression(enabledProperty.initializer).kind !== ts.SyntaxKind.TrueKeyword
  ) {
    return null;
  }

  const filepathProperty = getStaticPropertyAssignment(eslintrcExpression, "filepath");
  if (!filepathProperty) return path.join(packageDirectory, DEFAULT_ESLINT_GLOBALS_PATH);
  const filepathExpression = unwrapTypescriptExpression(filepathProperty.initializer);
  return ts.isStringLiteralLike(filepathExpression)
    ? path.resolve(packageDirectory, filepathExpression.text)
    : null;
};

const collectGlobalsPathsFromConfig = (
  configPath: string,
  packageDirectory: string,
): ReadonlyArray<string> => {
  let sourceText: string;
  try {
    sourceText = fs.readFileSync(configPath, "utf8");
  } catch {
    return [];
  }

  const sourceFile = ts.createSourceFile(configPath, sourceText, ts.ScriptTarget.Latest, true);
  const autoImportBindings = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      !AUTO_IMPORT_ADAPTER_PATTERN.test(statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const defaultBinding = statement.importClause?.name;
    if (defaultBinding) autoImportBindings.add(defaultBinding.text);
  }
  if (autoImportBindings.size === 0) return [];

  const globalsPaths = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      autoImportBindings.has(node.expression.text)
    ) {
      const globalsPath = getGlobalsPathFromAutoImportCall(node, packageDirectory);
      if (globalsPath) globalsPaths.add(globalsPath);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...globalsPaths];
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

  const globalsPaths = new Set<string>();
  for (const entry of directoryEntries) {
    if (!entry.isFile() || !CONFIG_FILENAMES.has(entry.name)) continue;
    const configPath = path.join(packageDirectory, entry.name);
    for (const globalsPath of collectGlobalsPathsFromConfig(configPath, packageDirectory)) {
      globalsPaths.add(globalsPath);
    }
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
