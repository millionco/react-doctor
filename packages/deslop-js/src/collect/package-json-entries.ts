import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import fg from "fast-glob";
import { resolveSourcePath } from "../resolver/source-path.js";
import {
  resolveEntryPathWithExtensions,
  resolveEntryWithExtensions,
} from "../utils/resolve-entry-with-extensions.js";

interface PackageJsonEntryFields {
  [key: string]: unknown;
  exports?: unknown;
  bin?: unknown;
  sideEffects?: unknown;
  build?: unknown;
  jest?: unknown;
}

interface PackageBuildConfig {
  files?: unknown;
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

export const findDefaultIndexEntry = (directory: string): string | undefined => {
  for (const pattern of DEFAULT_INDEX_PATTERNS) {
    const candidatePath = resolve(directory, pattern);
    if (existsSync(candidatePath)) return candidatePath;
  }
  return undefined;
};

const findSourceFile = (baseDirectory: string, relativePath: string): string | undefined => {
  const pathWithoutExtension = join(baseDirectory, relativePath).replace(/\.[cm]?js(x?)$/, "");
  for (const sourceExtension of SOURCE_EXTENSIONS) {
    const candidatePath = pathWithoutExtension + sourceExtension;
    if (existsSync(candidatePath)) return candidatePath;
  }
  const indexCandidate = join(pathWithoutExtension, "index.ts");
  return existsSync(indexCandidate) ? indexCandidate : undefined;
};

const findSourceFileStrict = (baseDirectory: string, relativePath: string): string | undefined => {
  const pathWithoutExtension = join(baseDirectory, relativePath).replace(/\.[cm]?js(x?)$/, "");
  for (const sourceExtension of SOURCE_EXTENSIONS) {
    const candidatePath = pathWithoutExtension + sourceExtension;
    if (existsSync(candidatePath)) return candidatePath;
  }
  const exactPath = join(baseDirectory, relativePath);
  return existsSync(exactPath) ? exactPath : undefined;
};

const resolveBuiltPathToSource = (
  builtAbsolutePath: string,
  rootDirectory: string,
): string | undefined => {
  if (existsSync(builtAbsolutePath)) return undefined;

  try {
    const tsconfigPath = join(rootDirectory, "tsconfig.json");
    if (!existsSync(tsconfigPath)) return undefined;
    const tsconfigContent = readFileSync(tsconfigPath, "utf-8")
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const tsconfig = JSON.parse(tsconfigContent);
    const outDirectory = tsconfig?.compilerOptions?.outDir;
    if (!outDirectory) return undefined;

    const absoluteOutDirectory = resolve(rootDirectory, outDirectory);
    const relativeToBuild = builtAbsolutePath.startsWith(absoluteOutDirectory)
      ? builtAbsolutePath.slice(absoluteOutDirectory.length)
      : undefined;
    if (!relativeToBuild) return undefined;

    const configuredRootDirectory = tsconfig?.compilerOptions?.rootDir;
    const sourceRoot = configuredRootDirectory
      ? resolve(rootDirectory, configuredRootDirectory)
      : rootDirectory;
    const sourceFileMatch = findSourceFile(sourceRoot, relativeToBuild);
    if (sourceFileMatch) return sourceFileMatch;
    const directCandidate = join(sourceRoot, relativeToBuild);
    if (existsSync(directCandidate)) return directCandidate;
    if (!configuredRootDirectory) {
      for (const sourceDirectory of COMMON_SOURCE_DIRECTORIES) {
        const candidate = findSourceFile(resolve(rootDirectory, sourceDirectory), relativeToBuild);
        if (candidate) return candidate;
      }
    }
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
  if (existsSync(absolutePath)) return absolutePath;
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
      const matchedFiles = fg.sync(normalizedPattern, {
        cwd: rootDirectory,
        absolute: true,
        onlyFiles: true,
        ignore: ["**/node_modules/**"],
      });
      entries.push(...matchedFiles.filter(isImportableSourceFile));
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

export const extractPackageJsonEntries = async (packageJsonPath: string): Promise<string[]> => {
  const entries: string[] = [];

  try {
    const content = await readFile(packageJsonPath, "utf-8");
    const packageJson: PackageJsonEntryFields = JSON.parse(content);
    const rootDirectory = packageJsonPath.replace(/\/package\.json$/, "");

    for (const field of PACKAGE_ENTRY_FIELDS) {
      const entryPath = packageJson[field];
      if (typeof entryPath === "string") entries.push(resolveEntryPath(entryPath, rootDirectory));
    }

    if (packageJson.exports) {
      const exportEntries: string[] = [];
      collectExportPaths(packageJson.exports, rootDirectory, exportEntries);
      for (const exportEntry of exportEntries) {
        const resolvedExportEntry =
          resolveEntryWithExtensions(exportEntry) ??
          resolveEntryPathWithExtensions(exportEntry, rootDirectory) ??
          resolveSourcePath(exportEntry, rootDirectory);
        if (resolvedExportEntry && existsSync(resolvedExportEntry)) {
          entries.push(resolvedExportEntry);
        } else if (
          exportEntry.endsWith(".ts") &&
          existsSync(exportEntry.replace(/\.ts$/, ".tsx"))
        ) {
          entries.push(exportEntry.replace(/\.ts$/, ".tsx"));
        } else {
          entries.push(
            existsSync(exportEntry) ? exportEntry : resolveEntryPath(exportEntry, rootDirectory),
          );
        }
      }
    }

    if (typeof packageJson.bin === "string") {
      entries.push(resolveEntryPath(packageJson.bin, rootDirectory));
    } else if (packageJson.bin && typeof packageJson.bin === "object") {
      for (const binPath of Object.values(packageJson.bin)) {
        if (typeof binPath === "string") entries.push(resolveEntryPath(binPath, rootDirectory));
      }
    }

    if (Array.isArray(packageJson.sideEffects)) {
      for (const sideEffectPattern of packageJson.sideEffects) {
        if (typeof sideEffectPattern !== "string") continue;
        for (const sourcePattern of expandSideEffectGlobToSourcePatterns(sideEffectPattern)) {
          entries.push(
            ...fg
              .sync(sourcePattern, {
                cwd: rootDirectory,
                absolute: true,
                onlyFiles: true,
                ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
              })
              .filter(isImportableSourceFile),
          );
        }
      }
    }

    const buildConfig: PackageBuildConfig | undefined =
      packageJson.build && typeof packageJson.build === "object" ? packageJson.build : undefined;
    if (Array.isArray(buildConfig?.files)) {
      for (const buildFileEntry of buildConfig.files) {
        if (typeof buildFileEntry !== "string" || buildFileEntry.includes("*")) continue;
        const resolvedBuildFile =
          resolveEntryWithExtensions(resolve(rootDirectory, buildFileEntry)) ??
          resolveEntryPathWithExtensions(buildFileEntry, rootDirectory);
        if (resolvedBuildFile && existsSync(resolvedBuildFile)) entries.push(resolvedBuildFile);
      }
    }

    if (packageJson.jest && typeof packageJson.jest === "object") {
      const jestConfigContent = JSON.stringify(packageJson.jest);
      for (const jestRootDirectoryMatch of jestConfigContent.matchAll(/<rootDir>\/([^"\\]+)/g)) {
        const resolvedJestFile = resolveEntryPathWithExtensions(
          jestRootDirectoryMatch[1],
          rootDirectory,
        );
        if (resolvedJestFile && existsSync(resolvedJestFile)) entries.push(resolvedJestFile);
      }
    }
  } catch {}

  return entries;
};
