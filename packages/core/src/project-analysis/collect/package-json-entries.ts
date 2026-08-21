import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import fg from "fast-glob";
import { resolveSourcePath } from "../resolver/source-path.js";
import {
  resolveEntryPathWithExtensions,
  resolveEntryWithExtensions,
} from "../utils/resolve-entry-with-extensions.js";
import { parseTypeScriptConfig } from "../utils/parse-typescript-config.js";

interface PackageJsonEntryFields {
  [key: string]: unknown;
  private?: boolean | string;
  description?: string;
  exports?: unknown;
  imports?: unknown;
  bin?: unknown;
  sideEffects?: unknown;
  build?: unknown;
  jest?: unknown;
  scripts?: unknown;
}

interface TypeScriptBuildDirectories {
  absoluteOutDirectory: string;
  sourceRoot: string;
  shouldSearchCommonSourceDirectories: boolean;
}

const DEFAULT_INDEX_PATTERNS = [
  "src/index.ts",
  "src/index.tsx",
  "src/index.js",
  "src/index.jsx",
  "src/main.ts",
  "src/main.tsx",
  "src/main.js",
  "src/main.jsx",
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "main.ts",
  "main.tsx",
  "main.js",
  "main.jsx",
];

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const COMMON_SOURCE_DIRECTORIES = ["src", "lib", "main", "app", "source"];
const BUILD_OUTPUT_DIRECTORY_PATTERN =
  /^(?:\.\/)?(?:dist(?:-[a-z]+)?|build|out|esm|cjs)\/(?:(?:esm|cjs|es|lib|commonjs|module)\/)?/;
const IMPORTABLE_EXTENSION_SET = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
  ".css",
  ".scss",
  ".less",
  ".sass",
]);
const PACKAGE_ENTRY_FIELDS = ["main", "module", "browser", "types", "typings", "style", "source"];

const COMPONENT_COMPOSITION_REGISTRY_DESCRIPTION = "Registry for component compositions";

export const findDefaultIndexEntry = (directory: string): string | undefined => {
  for (const pattern of DEFAULT_INDEX_PATTERNS) {
    const candidatePath = resolve(directory, pattern);
    if (existsSync(candidatePath)) return candidatePath;
  }
  return undefined;
};

const findSourceFileWithKnownExtension = (pathWithoutExtension: string): string | undefined => {
  for (const sourceExtension of SOURCE_EXTENSIONS) {
    const candidatePath = pathWithoutExtension + sourceExtension;
    if (existsSync(candidatePath)) return candidatePath;
  }
  return undefined;
};

const findSourceFile = (
  baseDirectory: string,
  relativePath: string,
  shouldResolveDirectoryIndex = true,
): string | undefined => {
  const pathWithoutExtension = join(baseDirectory, relativePath).replace(/\.[cm]?js(x?)$/, "");
  const sourceFile = findSourceFileWithKnownExtension(pathWithoutExtension);
  if (sourceFile) return sourceFile;
  const fallbackPath = shouldResolveDirectoryIndex
    ? join(pathWithoutExtension, "index.ts")
    : join(baseDirectory, relativePath);
  return existsSync(fallbackPath) ? fallbackPath : undefined;
};

const findSourceFileStrict = (baseDirectory: string, relativePath: string): string | undefined =>
  findSourceFile(baseDirectory, relativePath, false);

const readTypeScriptBuildDirectories = (
  rootDirectory: string,
): TypeScriptBuildDirectories | undefined => {
  const tsconfigPath = join(rootDirectory, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return undefined;
  const tsconfig = parseTypeScriptConfig(tsconfigPath, readFileSync(tsconfigPath, "utf-8"));
  const outDirectory = tsconfig?.compilerOptions?.outDir;
  if (typeof outDirectory !== "string" || outDirectory.length === 0) return undefined;

  const configuredRootDirectory = tsconfig?.compilerOptions?.rootDir;
  return {
    absoluteOutDirectory: resolve(rootDirectory, outDirectory),
    sourceRoot:
      typeof configuredRootDirectory === "string"
        ? resolve(rootDirectory, configuredRootDirectory)
        : rootDirectory,
    shouldSearchCommonSourceDirectories: typeof configuredRootDirectory !== "string",
  };
};

const findRelativeBuildPath = (
  absoluteOutDirectory: string,
  builtAbsolutePath: string,
): string | undefined => {
  const relativeToBuild = relative(absoluteOutDirectory, builtAbsolutePath);
  if (
    relativeToBuild.length === 0 ||
    relativeToBuild === ".." ||
    relativeToBuild.startsWith(`..${sep}`) ||
    isAbsolute(relativeToBuild)
  ) {
    return undefined;
  }
  return relativeToBuild;
};

const findSourcePathForBuildOutput = (
  buildDirectories: TypeScriptBuildDirectories,
  relativeBuildPath: string,
  rootDirectory: string,
): string | undefined => {
  const sourceFileMatch = findSourceFile(buildDirectories.sourceRoot, relativeBuildPath);
  if (sourceFileMatch) return sourceFileMatch;
  const directCandidate = join(buildDirectories.sourceRoot, relativeBuildPath);
  if (existsSync(directCandidate)) return directCandidate;
  if (!buildDirectories.shouldSearchCommonSourceDirectories) return undefined;

  for (const sourceDirectory of COMMON_SOURCE_DIRECTORIES) {
    const candidate = findSourceFile(resolve(rootDirectory, sourceDirectory), relativeBuildPath);
    if (candidate) return candidate;
  }
  return undefined;
};

const resolveBuiltPathToSource = (
  builtAbsolutePath: string,
  rootDirectory: string,
): string | undefined => {
  if (existsSync(builtAbsolutePath)) return undefined;

  try {
    const buildDirectories = readTypeScriptBuildDirectories(rootDirectory);
    if (!buildDirectories) return undefined;
    const relativeBuildPath = findRelativeBuildPath(
      buildDirectories.absoluteOutDirectory,
      builtAbsolutePath,
    );
    if (!relativeBuildPath) return undefined;
    return findSourcePathForBuildOutput(buildDirectories, relativeBuildPath, rootDirectory);
  } catch {}
  return undefined;
};

const resolveEntryPathViaHeuristic = (
  entryPath: string,
  rootDirectory: string,
): string | undefined => {
  const buildDirectoryMatch = entryPath.match(BUILD_OUTPUT_DIRECTORY_PATTERN);
  if (!buildDirectoryMatch) return undefined;
  const relativeToBuildDirectory = entryPath.slice(buildDirectoryMatch[0].length);
  for (const sourceDirectory of COMMON_SOURCE_DIRECTORIES) {
    const sourceBaseDirectory = resolve(rootDirectory, sourceDirectory);
    if (!existsSync(sourceBaseDirectory)) continue;
    const sourceFileMatch = findSourceFileStrict(sourceBaseDirectory, relativeToBuildDirectory);
    if (sourceFileMatch) return sourceFileMatch;
  }
  return undefined;
};

const resolveEntryPath = (entryPath: string, rootDirectory: string): string => {
  const absolutePath = resolve(rootDirectory, entryPath);
  const normalizedEntry = entryPath.replace(/^\.\//, "");
  if (BUILD_OUTPUT_DIRECTORY_PATTERN.test(normalizedEntry)) {
    const sourcePath = resolveBuiltPathToSource(absolutePath, rootDirectory);
    if (sourcePath) return sourcePath;
    const heuristicMatch = resolveEntryPathViaHeuristic(normalizedEntry, rootDirectory);
    if (heuristicMatch) return heuristicMatch;
  }
  const directlyResolvedPath = resolveEntryWithExtensions(absolutePath);
  if (directlyResolvedPath) return directlyResolvedPath;
  return (
    resolveBuiltPathToSource(absolutePath, rootDirectory) ??
    findSourceFile(rootDirectory, normalizedEntry) ??
    resolveEntryPathViaHeuristic(normalizedEntry, rootDirectory) ??
    absolutePath
  );
};

const collectExportPaths = (
  exportValue: unknown,
  rootDirectory: string,
  entries: string[],
): void => {
  if (typeof exportValue === "string") {
    if (exportValue.includes("*")) {
      const normalizedPattern = exportValue.startsWith("./") ? exportValue.slice(2) : exportValue;
      const recursivePattern = normalizedPattern.includes("/")
        ? normalizedPattern.replaceAll("*", "**/*")
        : normalizedPattern;
      entries.push(...findImportableFiles(recursivePattern, rootDirectory, ["**/node_modules/**"]));
    } else {
      entries.push(resolveEntryPath(exportValue, rootDirectory));
    }
    return;
  }
  if (!exportValue || typeof exportValue !== "object") return;
  for (const nestedExportValue of Object.values(exportValue)) {
    collectExportPaths(nestedExportValue, rootDirectory, entries);
  }
};

const isImportableSourceFile = (filePath: string): boolean =>
  IMPORTABLE_EXTENSION_SET.has(filePath.slice(filePath.lastIndexOf(".")));

const findImportableFiles = (
  pattern: string,
  rootDirectory: string,
  ignoredPatterns: string[],
): string[] =>
  fg
    .sync(pattern, {
      cwd: rootDirectory,
      absolute: true,
      onlyFiles: true,
      ignore: ignoredPatterns,
    })
    .filter(isImportableSourceFile);

const expandSideEffectGlobToSourcePatterns = (pattern: string): string[] => {
  const patterns = new Set<string>([pattern]);
  if (pattern.endsWith(".js")) {
    patterns.add(pattern.replace(/\.js$/, ".ts"));
    patterns.add(pattern.replace(/\.js$/, ".tsx"));
  }
  if (pattern.includes("/lib/") || pattern.startsWith("lib/")) {
    patterns.add(pattern.replace(/\blib\b/g, "src"));
  }
  if (pattern.includes("/esm/") || pattern.startsWith("esm/")) {
    patterns.add(pattern.replace(/\besm\b/g, "src"));
  }
  return [...patterns];
};

const collectFieldEntries = (
  packageJson: PackageJsonEntryFields,
  rootDirectory: string,
  entries: string[],
): void => {
  for (const field of PACKAGE_ENTRY_FIELDS) {
    const entryPath = packageJson[field];
    if (typeof entryPath === "string") entries.push(resolveEntryPath(entryPath, rootDirectory));
  }
};

const resolveExportEntry = (exportEntry: string, rootDirectory: string): string => {
  const resolvedExportEntry =
    resolveEntryWithExtensions(exportEntry) ??
    resolveEntryPathWithExtensions(exportEntry, rootDirectory) ??
    resolveSourcePath(exportEntry, rootDirectory);
  if (resolvedExportEntry && existsSync(resolvedExportEntry)) return resolvedExportEntry;

  const typescriptReactEntry = exportEntry.endsWith(".ts")
    ? exportEntry.replace(/\.ts$/, ".tsx")
    : undefined;
  if (typescriptReactEntry && existsSync(typescriptReactEntry)) return typescriptReactEntry;
  return existsSync(exportEntry) ? exportEntry : resolveEntryPath(exportEntry, rootDirectory);
};

const collectPackageExportEntries = (
  exportValue: unknown,
  rootDirectory: string,
  entries: string[],
): void => {
  if (!exportValue) return;
  const exportEntries: string[] = [];
  collectExportPaths(exportValue, rootDirectory, exportEntries);
  for (const exportEntry of exportEntries) {
    entries.push(resolveExportEntry(exportEntry, rootDirectory));
  }
};

const collectPackageBinEntries = (
  binValue: unknown,
  rootDirectory: string,
  entries: string[],
): void => {
  if (typeof binValue === "string") {
    entries.push(resolveEntryPath(binValue, rootDirectory));
    return;
  }
  if (!binValue || typeof binValue !== "object") return;
  for (const binPath of Object.values(binValue)) {
    if (typeof binPath === "string") entries.push(resolveEntryPath(binPath, rootDirectory));
  }
};

const collectSideEffectEntries = (
  sideEffectValue: unknown,
  rootDirectory: string,
  entries: string[],
): void => {
  if (!Array.isArray(sideEffectValue)) return;
  for (const sideEffectPattern of sideEffectValue) {
    if (typeof sideEffectPattern !== "string") continue;
    for (const sourcePattern of expandSideEffectGlobToSourcePatterns(sideEffectPattern)) {
      entries.push(
        ...findImportableFiles(sourcePattern, rootDirectory, [
          "**/node_modules/**",
          "**/dist/**",
          "**/build/**",
        ]),
      );
    }
  }
};

const collectBuildEntries = (
  buildValue: unknown,
  rootDirectory: string,
  entries: string[],
): void => {
  if (typeof buildValue !== "object" || buildValue === null) return;
  const buildFileEntries: unknown = Reflect.get(buildValue, "files");
  if (!Array.isArray(buildFileEntries)) return;

  for (const buildFileEntry of buildFileEntries) {
    if (typeof buildFileEntry !== "string" || buildFileEntry.includes("*")) continue;
    const resolvedBuildFile = resolveEntryPathWithExtensions(buildFileEntry, rootDirectory);
    if (resolvedBuildFile && existsSync(resolvedBuildFile)) entries.push(resolvedBuildFile);
  }
};

const collectJestEntries = (jestValue: unknown, rootDirectory: string, entries: string[]): void => {
  if (!jestValue || typeof jestValue !== "object") return;
  const jestConfigContent = JSON.stringify(jestValue);
  for (const jestRootDirectoryMatch of jestConfigContent.matchAll(/<rootDir>\/([^"\\]+)/g)) {
    const resolvedJestFile = resolveEntryPathWithExtensions(
      jestRootDirectoryMatch[1],
      rootDirectory,
    );
    if (resolvedJestFile && existsSync(resolvedJestFile)) entries.push(resolvedJestFile);
  }
};

const TYPE_TEST_DIRECTORY_PATTERN = /^(?:public-types|type-tests?|types-tests?|typetests|tsd)$/;
const TYPE_TEST_SCRIPT_PATTERN = /(?:^|\s)(?:tsc|tsgo)(?:\s|$)/;

const collectTypeTestFixtureEntries = (
  packageJson: PackageJsonEntryFields,
  rootDirectory: string,
  entries: string[],
): void => {
  const directoryName = rootDirectory.slice(rootDirectory.lastIndexOf(sep) + 1);
  const isPrivate = packageJson.private === true || packageJson.private === "true";
  if (!isPrivate || !TYPE_TEST_DIRECTORY_PATTERN.test(directoryName)) return;
  if (!packageJson.scripts || typeof packageJson.scripts !== "object") return;
  const invokesTypeScript = Object.values(packageJson.scripts).some(
    (scriptValue) => typeof scriptValue === "string" && TYPE_TEST_SCRIPT_PATTERN.test(scriptValue),
  );
  if (!invokesTypeScript) return;

  const tsconfigPath = join(rootDirectory, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return;
  try {
    const tsconfig = parseTypeScriptConfig(tsconfigPath, readFileSync(tsconfigPath, "utf8"));
    if (tsconfig?.compilerOptions?.noEmit !== true || !Array.isArray(tsconfig.include)) return;
    const includePatterns = tsconfig.include.filter(
      (includePattern: unknown): includePattern is string => typeof includePattern === "string",
    );
    if (includePatterns.length === 0) return;
    const excludePatterns = Array.isArray(tsconfig.exclude)
      ? tsconfig.exclude.filter(
          (excludePattern: unknown): excludePattern is string => typeof excludePattern === "string",
        )
      : [];
    entries.push(
      ...fg
        .sync(includePatterns, {
          cwd: rootDirectory,
          absolute: true,
          onlyFiles: true,
          ignore: ["**/node_modules/**", ...excludePatterns],
        })
        .filter(isImportableSourceFile),
    );
  } catch {}
};

const collectComponentCompositionRegistryEntries = (
  packageJson: PackageJsonEntryFields,
  rootDirectory: string,
  entries: string[],
): void => {
  const isPrivate = packageJson.private === true || packageJson.private === "true";
  if (!isPrivate || packageJson.description !== COMPONENT_COMPOSITION_REGISTRY_DESCRIPTION) return;
  entries.push(...findImportableFiles("src/**/*", rootDirectory, ["**/node_modules/**"]));
};

export const extractPackageJsonEntries = async (packageJsonPath: string): Promise<string[]> => {
  const entries: string[] = [];

  try {
    const content = await readFile(packageJsonPath, "utf-8");
    const packageJson: PackageJsonEntryFields = JSON.parse(content);
    const rootDirectory = dirname(packageJsonPath);

    collectFieldEntries(packageJson, rootDirectory, entries);
    collectPackageExportEntries(packageJson.exports, rootDirectory, entries);
    collectPackageExportEntries(packageJson.imports, rootDirectory, entries);
    collectPackageBinEntries(packageJson.bin, rootDirectory, entries);
    collectSideEffectEntries(packageJson.sideEffects, rootDirectory, entries);
    collectBuildEntries(packageJson.build, rootDirectory, entries);
    collectJestEntries(packageJson.jest, rootDirectory, entries);
    collectTypeTestFixtureEntries(packageJson, rootDirectory, entries);
    collectComponentCompositionRegistryEntries(packageJson, rootDirectory, entries);
  } catch {}

  return entries;
};
