import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  GIT_LS_FILES_MAX_BUFFER_BYTES,
  IGNORED_DIRECTORIES,
  SOURCE_FILE_PATTERN,
} from "../constants.js";
import type {
  DependencyInfo,
  Framework,
  PackageJson,
  ProjectInfo,
  WorkspacePackage,
} from "../types.js";
import { findMonorepoRoot, isMonorepoRoot } from "./find-monorepo-root.js";
import { isFile } from "./is-file.js";
import { isPlainObject } from "./is-plain-object.js";
import { readPackageJson } from "./read-package-json.js";

const REACT_COMPILER_PACKAGES = new Set([
  "babel-plugin-react-compiler",
  "react-compiler-runtime",
  "eslint-plugin-react-compiler",
]);

const TANSTACK_QUERY_PACKAGES = new Set([
  "@tanstack/react-query",
  "@tanstack/query-core",
  "react-query",
]);

const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cjs",
];

const BABEL_CONFIG_FILENAMES = [
  ".babelrc",
  ".babelrc.json",
  "babel.config.js",
  "babel.config.json",
  "babel.config.cjs",
  "babel.config.mjs",
];

const VITE_CONFIG_FILENAMES = [
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "vite.config.mts",
  "vite.config.cjs",
  "vite.config.cts",
  "vitest.config.ts",
  "vitest.config.js",
];

const EXPO_APP_CONFIG_FILENAMES = ["app.json", "app.config.js", "app.config.ts"];

const REACT_COMPILER_PACKAGE_REFERENCE_PATTERN =
  /babel-plugin-react-compiler|react-compiler-runtime|eslint-plugin-react-compiler|["']react-compiler["']/;
const REACT_COMPILER_ENABLED_FLAG_PATTERN = /["']?reactCompiler["']?\s*:\s*(?:true\b|\{)/;

const FRAMEWORK_PACKAGES: Record<string, Framework> = {
  next: "nextjs",
  "@tanstack/react-start": "tanstack-start",
  vite: "vite",
  "react-scripts": "cra",
  "@remix-run/react": "remix",
  gatsby: "gatsby",
  expo: "expo",
  "react-native": "react-native",
};

const FRAMEWORK_DISPLAY_NAMES: Record<Framework, string> = {
  nextjs: "Next.js",
  "tanstack-start": "TanStack Start",
  vite: "Vite",
  cra: "Create React App",
  remix: "Remix",
  gatsby: "Gatsby",
  expo: "Expo",
  "react-native": "React Native",
  unknown: "React",
};

export const formatFrameworkName = (framework: Framework): string =>
  FRAMEWORK_DISPLAY_NAMES[framework];

const countSourceFilesViaFilesystem = (rootDirectory: string): number => {
  let count = 0;
  const stack = [rootDirectory];

  while (stack.length > 0) {
    const currentDirectory = stack.pop()!;
    const entries = fs.readdirSync(currentDirectory, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith(".") && !IGNORED_DIRECTORIES.has(entry.name)) {
          stack.push(path.join(currentDirectory, entry.name));
        }
        continue;
      }
      if (entry.isFile() && SOURCE_FILE_PATTERN.test(entry.name)) {
        count++;
      }
    }
  }

  return count;
};

const countSourceFilesViaGit = (rootDirectory: string): number | null => {
  // HACK: do NOT add --recurse-submodules — it's incompatible with
  // --others / --exclude-standard and git rejects the combination, which
  // would silently force every scan to fall back to the much slower
  // filesystem walk in countSourceFilesViaFilesystem.
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    {
      cwd: rootDirectory,
      encoding: "utf-8",
      maxBuffer: GIT_LS_FILES_MAX_BUFFER_BYTES,
    },
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout
    .split("\0")
    .filter((filePath) => filePath.length > 0 && SOURCE_FILE_PATTERN.test(filePath)).length;
};

const countSourceFiles = (rootDirectory: string): number =>
  countSourceFilesViaGit(rootDirectory) ?? countSourceFilesViaFilesystem(rootDirectory);

const collectAllDependencies = (packageJson: PackageJson): Record<string, string> => ({
  ...packageJson.peerDependencies,
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
});

const detectFramework = (dependencies: Record<string, string>): Framework => {
  for (const [packageName, frameworkName] of Object.entries(FRAMEWORK_PACKAGES)) {
    if (dependencies[packageName]) {
      return frameworkName;
    }
  }
  return "unknown";
};

const isCatalogReference = (version: string): boolean => version.startsWith("catalog:");

const extractCatalogName = (version: string): string | null => {
  if (!isCatalogReference(version)) return null;
  const name = version.slice("catalog:".length).trim();
  return name.length > 0 ? name : null;
};

const resolveVersionFromCatalog = (
  catalog: Record<string, unknown>,
  packageName: string,
): string | null => {
  const version = catalog[packageName];
  if (typeof version === "string" && !isCatalogReference(version)) return version;
  return null;
};

interface CatalogCollection {
  defaultCatalog: Record<string, string>;
  namedCatalogs: Record<string, Record<string, string>>;
}

const parsePnpmWorkspaceCatalogs = (rootDirectory: string): CatalogCollection => {
  const workspacePath = path.join(rootDirectory, "pnpm-workspace.yaml");
  if (!isFile(workspacePath)) return { defaultCatalog: {}, namedCatalogs: {} };

  const content = fs.readFileSync(workspacePath, "utf-8");
  const defaultCatalog: Record<string, string> = {};
  const namedCatalogs: Record<string, Record<string, string>> = {};

  let currentSection: "none" | "catalog" | "catalogs" | "named-catalog" = "none";
  let currentCatalogName = "";

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;

    const indentLevel = line.search(/\S/);

    if (indentLevel === 0 && trimmed === "catalog:") {
      currentSection = "catalog";
      continue;
    }
    if (indentLevel === 0 && trimmed === "catalogs:") {
      currentSection = "catalogs";
      continue;
    }
    if (indentLevel === 0) {
      currentSection = "none";
      continue;
    }

    if (currentSection === "catalog" && indentLevel > 0) {
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex).trim().replace(/["']/g, "");
        const value = trimmed
          .slice(colonIndex + 1)
          .trim()
          .replace(/["']/g, "");
        if (key && value) defaultCatalog[key] = value;
      }
      continue;
    }

    if (currentSection === "catalogs" && indentLevel > 0) {
      if (trimmed.endsWith(":") && !trimmed.includes(" ")) {
        currentCatalogName = trimmed.slice(0, -1).replace(/["']/g, "");
        currentSection = "named-catalog";
        namedCatalogs[currentCatalogName] = {};
        continue;
      }
    }

    if (currentSection === "named-catalog" && indentLevel > 0) {
      if (indentLevel <= 2 && trimmed.endsWith(":") && !trimmed.includes(" ")) {
        currentCatalogName = trimmed.slice(0, -1).replace(/["']/g, "");
        namedCatalogs[currentCatalogName] = {};
        continue;
      }
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex > 0 && currentCatalogName) {
        const key = trimmed.slice(0, colonIndex).trim().replace(/["']/g, "");
        const value = trimmed
          .slice(colonIndex + 1)
          .trim()
          .replace(/["']/g, "");
        if (key && value) namedCatalogs[currentCatalogName][key] = value;
      }
    }
  }

  return { defaultCatalog, namedCatalogs };
};

const resolveCatalogVersionFromCollection = (
  catalogs: CatalogCollection,
  packageName: string,
  catalogReference?: string | null,
): string | null => {
  if (catalogReference) {
    const namedCatalog = catalogs.namedCatalogs[catalogReference];
    if (namedCatalog?.[packageName]) return namedCatalog[packageName];
  }

  if (catalogs.defaultCatalog[packageName]) return catalogs.defaultCatalog[packageName];

  for (const namedCatalog of Object.values(catalogs.namedCatalogs)) {
    if (namedCatalog[packageName]) return namedCatalog[packageName];
  }

  return null;
};

const resolveCatalogVersion = (
  packageJson: PackageJson,
  packageName: string,
  rootDirectory?: string,
): string | null => {
  const allDependencies = collectAllDependencies(packageJson);
  const rawVersion = allDependencies[packageName];
  const catalogName = rawVersion ? extractCatalogName(rawVersion) : null;

  if (isPlainObject(packageJson.catalog)) {
    const version = resolveVersionFromCatalog(packageJson.catalog, packageName);
    if (version) return version;
  }

  if (isPlainObject(packageJson.catalogs)) {
    const namedCatalog = catalogName ? packageJson.catalogs[catalogName] : undefined;
    if (namedCatalog && isPlainObject(namedCatalog)) {
      const version = resolveVersionFromCatalog(namedCatalog, packageName);
      if (version) return version;
    }
    for (const catalogEntries of Object.values(packageJson.catalogs)) {
      if (isPlainObject(catalogEntries)) {
        const version = resolveVersionFromCatalog(catalogEntries, packageName);
        if (version) return version;
      }
    }
  }

  const workspaces = packageJson.workspaces;
  if (workspaces && !Array.isArray(workspaces) && isPlainObject(workspaces.catalog)) {
    const version = resolveVersionFromCatalog(workspaces.catalog, packageName);
    if (version) return version;
  }

  if (rootDirectory) {
    const pnpmCatalogs = parsePnpmWorkspaceCatalogs(rootDirectory);
    const pnpmVersion = resolveCatalogVersionFromCollection(pnpmCatalogs, packageName, catalogName);
    if (pnpmVersion) return pnpmVersion;
  }

  return null;
};

const extractDependencyInfo = (packageJson: PackageJson): DependencyInfo => {
  const allDependencies = collectAllDependencies(packageJson);
  const rawVersion = allDependencies.react ?? null;
  const reactVersion = rawVersion && !isCatalogReference(rawVersion) ? rawVersion : null;
  return {
    reactVersion,
    framework: detectFramework(allDependencies),
  };
};

const parsePnpmWorkspacePatterns = (rootDirectory: string): string[] => {
  const workspacePath = path.join(rootDirectory, "pnpm-workspace.yaml");
  if (!isFile(workspacePath)) return [];

  const content = fs.readFileSync(workspacePath, "utf-8");
  const patterns: string[] = [];
  let isInsidePackagesBlock = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "packages:") {
      isInsidePackagesBlock = true;
      continue;
    }
    if (isInsidePackagesBlock && trimmed.startsWith("-")) {
      patterns.push(trimmed.replace(/^-\s*/, "").replace(/["']/g, ""));
    } else if (isInsidePackagesBlock && trimmed.length > 0 && !trimmed.startsWith("#")) {
      isInsidePackagesBlock = false;
    }
  }

  return patterns;
};

const NX_PROJECT_DISCOVERY_DIRS = ["apps", "libs", "packages"];

const getNxWorkspaceDirectories = (rootDirectory: string): string[] => {
  if (!isFile(path.join(rootDirectory, "nx.json"))) return [];

  const collected: string[] = [];
  for (const candidate of NX_PROJECT_DISCOVERY_DIRS) {
    const candidatePath = path.join(rootDirectory, candidate);
    if (!fs.existsSync(candidatePath) || !fs.statSync(candidatePath).isDirectory()) continue;
    for (const entry of fs.readdirSync(candidatePath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const projectDirectory = path.join(candidatePath, entry.name);
      if (
        isFile(path.join(projectDirectory, "project.json")) ||
        isFile(path.join(projectDirectory, "package.json"))
      ) {
        collected.push(`${candidate}/${entry.name}`);
      }
    }
  }
  return collected;
};

const getWorkspacePatterns = (rootDirectory: string, packageJson: PackageJson): string[] => {
  const pnpmPatterns = parsePnpmWorkspacePatterns(rootDirectory);
  if (pnpmPatterns.length > 0) return pnpmPatterns;

  if (Array.isArray(packageJson.workspaces)) {
    return packageJson.workspaces;
  }

  if (packageJson.workspaces?.packages) {
    return packageJson.workspaces.packages;
  }

  const nxPatterns = getNxWorkspaceDirectories(rootDirectory);
  if (nxPatterns.length > 0) return nxPatterns;

  return [];
};

const resolveWorkspaceDirectories = (rootDirectory: string, pattern: string): string[] => {
  const cleanPattern = pattern.replace(/["']/g, "").replace(/\/\*\*$/, "/*");

  if (!cleanPattern.includes("*")) {
    const directoryPath = path.join(rootDirectory, cleanPattern);
    if (fs.existsSync(directoryPath) && isFile(path.join(directoryPath, "package.json"))) {
      return [directoryPath];
    }
    return [];
  }

  const wildcardIndex = cleanPattern.indexOf("*");
  const baseDirectory = path.join(rootDirectory, cleanPattern.slice(0, wildcardIndex));
  const suffixAfterWildcard = cleanPattern.slice(wildcardIndex + 1);

  if (!fs.existsSync(baseDirectory) || !fs.statSync(baseDirectory).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(baseDirectory)
    .map((entry) => path.join(baseDirectory, entry, suffixAfterWildcard))
    .filter(
      (entryPath) =>
        fs.existsSync(entryPath) &&
        fs.statSync(entryPath).isDirectory() &&
        isFile(path.join(entryPath, "package.json")),
    );
};

const findDependencyInfoFromMonorepoRoot = (directory: string): DependencyInfo => {
  const monorepoRoot = findMonorepoRoot(directory);
  if (!monorepoRoot) return { reactVersion: null, framework: "unknown" };

  const monorepoPackageJsonPath = path.join(monorepoRoot, "package.json");
  if (!isFile(monorepoPackageJsonPath)) return { reactVersion: null, framework: "unknown" };

  const rootPackageJson = readPackageJson(monorepoPackageJsonPath);
  const rootInfo = extractDependencyInfo(rootPackageJson);
  const catalogVersion = resolveCatalogVersion(rootPackageJson, "react", monorepoRoot);
  const workspaceInfo = findReactInWorkspaces(monorepoRoot, rootPackageJson);

  return {
    reactVersion: rootInfo.reactVersion ?? catalogVersion ?? workspaceInfo.reactVersion,
    framework: rootInfo.framework !== "unknown" ? rootInfo.framework : workspaceInfo.framework,
  };
};

const findReactInWorkspaces = (rootDirectory: string, packageJson: PackageJson): DependencyInfo => {
  const patterns = getWorkspacePatterns(rootDirectory, packageJson);
  const result: DependencyInfo = { reactVersion: null, framework: "unknown" };

  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);

    for (const workspaceDirectory of directories) {
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));
      const info = extractDependencyInfo(workspacePackageJson);

      if (info.reactVersion && !result.reactVersion) {
        result.reactVersion = info.reactVersion;
      }
      if (info.framework !== "unknown" && result.framework === "unknown") {
        result.framework = info.framework;
      }

      if (result.reactVersion && result.framework !== "unknown") {
        return result;
      }
    }
  }

  return result;
};

const REACT_DEPENDENCY_NAMES = new Set(["react", "react-native", "next"]);

const hasReactDependency = (packageJson: PackageJson): boolean => {
  const allDependencies = collectAllDependencies(packageJson);
  return Object.keys(allDependencies).some((packageName) =>
    REACT_DEPENDENCY_NAMES.has(packageName),
  );
};

export const discoverReactSubprojects = (rootDirectory: string): WorkspacePackage[] => {
  if (!fs.existsSync(rootDirectory) || !fs.statSync(rootDirectory).isDirectory()) return [];

  const packages: WorkspacePackage[] = [];

  const rootPackageJsonPath = path.join(rootDirectory, "package.json");
  if (isFile(rootPackageJsonPath)) {
    const rootPackageJson = readPackageJson(rootPackageJsonPath);
    if (hasReactDependency(rootPackageJson)) {
      const name = rootPackageJson.name ?? path.basename(rootDirectory);
      packages.push({ name, directory: rootDirectory });
    }
  }

  const entries = fs.readdirSync(rootDirectory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }

    const subdirectory = path.join(rootDirectory, entry.name);
    const packageJsonPath = path.join(subdirectory, "package.json");
    if (!isFile(packageJsonPath)) continue;

    const packageJson = readPackageJson(packageJsonPath);
    if (!hasReactDependency(packageJson)) continue;

    const name = packageJson.name ?? entry.name;
    packages.push({ name, directory: subdirectory });
  }

  return packages;
};

export const listWorkspacePackages = (rootDirectory: string): WorkspacePackage[] => {
  const packageJsonPath = path.join(rootDirectory, "package.json");
  if (!isFile(packageJsonPath)) return [];

  const packageJson = readPackageJson(packageJsonPath);
  const patterns = getWorkspacePatterns(rootDirectory, packageJson);
  if (patterns.length === 0) return [];

  const packages: WorkspacePackage[] = [];

  if (hasReactDependency(packageJson)) {
    const rootName = packageJson.name ?? path.basename(rootDirectory);
    packages.push({ name: rootName, directory: rootDirectory });
  }

  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);
    for (const workspaceDirectory of directories) {
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));

      if (!hasReactDependency(workspacePackageJson)) continue;

      const name = workspacePackageJson.name ?? path.basename(workspaceDirectory);
      packages.push({ name, directory: workspaceDirectory });
    }
  }

  return packages;
};

const hasCompilerPackage = (packageJson: PackageJson): boolean => {
  const allDependencies = collectAllDependencies(packageJson);
  return Object.keys(allDependencies).some((packageName) =>
    REACT_COMPILER_PACKAGES.has(packageName),
  );
};

const fileContainsPattern = (filePath: string, pattern: RegExp): boolean => {
  if (!isFile(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  return pattern.test(content);
};

const hasCompilerInConfigFile = (filePath: string): boolean => {
  if (!isFile(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  return (
    REACT_COMPILER_ENABLED_FLAG_PATTERN.test(content) ||
    REACT_COMPILER_PACKAGE_REFERENCE_PATTERN.test(content)
  );
};

const hasCompilerInConfigFiles = (directory: string, filenames: string[]): boolean =>
  filenames.some((filename) => hasCompilerInConfigFile(path.join(directory, filename)));

const isProjectBoundary = (directory: string): boolean => {
  if (fs.existsSync(path.join(directory, ".git"))) return true;
  return isMonorepoRoot(directory);
};

const detectReactCompiler = (directory: string, packageJson: PackageJson): boolean => {
  if (hasCompilerPackage(packageJson)) return true;

  if (hasCompilerInConfigFiles(directory, NEXT_CONFIG_FILENAMES)) return true;
  if (hasCompilerInConfigFiles(directory, BABEL_CONFIG_FILENAMES)) return true;
  if (hasCompilerInConfigFiles(directory, VITE_CONFIG_FILENAMES)) return true;
  if (hasCompilerInConfigFiles(directory, EXPO_APP_CONFIG_FILENAMES)) return true;

  if (isProjectBoundary(directory)) return false;

  let ancestorDirectory = path.dirname(directory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorPackagePath = path.join(ancestorDirectory, "package.json");
    if (isFile(ancestorPackagePath)) {
      const ancestorPackageJson = readPackageJson(ancestorPackagePath);
      if (hasCompilerPackage(ancestorPackageJson)) return true;
    }
    if (isProjectBoundary(ancestorDirectory)) return false;
    ancestorDirectory = path.dirname(ancestorDirectory);
  }

  return false;
};

const cachedProjectInfos = new Map<string, ProjectInfo>();

// HACK: paired with clearConfigCache — exposed so programmatic API
// consumers can re-detect after the project's package.json /
// tsconfig.json / monorepo manifests change between diagnose() calls.
export const clearProjectCache = (): void => {
  cachedProjectInfos.clear();
};

export const discoverProject = (directory: string): ProjectInfo => {
  const cached = cachedProjectInfos.get(directory);
  if (cached !== undefined) return cached;

  const packageJsonPath = path.join(directory, "package.json");
  if (!isFile(packageJsonPath)) {
    throw new Error(`No package.json found in ${directory}`);
  }

  const packageJson = readPackageJson(packageJsonPath);
  let { reactVersion, framework } = extractDependencyInfo(packageJson);

  if (!reactVersion) {
    reactVersion = resolveCatalogVersion(packageJson, "react", directory);
  }

  if (!reactVersion) {
    const monorepoRoot = findMonorepoRoot(directory);
    if (monorepoRoot) {
      const monorepoPackageJsonPath = path.join(monorepoRoot, "package.json");
      if (isFile(monorepoPackageJsonPath)) {
        const rootPackageJson = readPackageJson(monorepoPackageJsonPath);
        reactVersion = resolveCatalogVersion(rootPackageJson, "react", monorepoRoot);
      }
    }
  }

  if (!reactVersion || framework === "unknown") {
    const workspaceInfo = findReactInWorkspaces(directory, packageJson);
    if (!reactVersion && workspaceInfo.reactVersion) {
      reactVersion = workspaceInfo.reactVersion;
    }
    if (framework === "unknown" && workspaceInfo.framework !== "unknown") {
      framework = workspaceInfo.framework;
    }
  }

  if ((!reactVersion || framework === "unknown") && !isMonorepoRoot(directory)) {
    const monorepoInfo = findDependencyInfoFromMonorepoRoot(directory);
    if (!reactVersion) {
      reactVersion = monorepoInfo.reactVersion;
    }
    if (framework === "unknown") {
      framework = monorepoInfo.framework;
    }
  }

  const projectName = packageJson.name ?? path.basename(directory);
  const hasTypeScript = fs.existsSync(path.join(directory, "tsconfig.json"));
  const sourceFileCount = countSourceFiles(directory);

  const hasReactCompiler = detectReactCompiler(directory, packageJson);
  const allDependencies = collectAllDependencies(packageJson);
  const hasTanStackQuery = Object.keys(allDependencies).some((packageName) =>
    TANSTACK_QUERY_PACKAGES.has(packageName),
  );

  const projectInfo: ProjectInfo = {
    rootDirectory: directory,
    projectName,
    reactVersion,
    framework,
    hasTypeScript,
    hasReactCompiler,
    hasTanStackQuery,
    sourceFileCount,
  };
  cachedProjectInfos.set(directory, projectInfo);
  return projectInfo;
};
