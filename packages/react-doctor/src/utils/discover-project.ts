import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { GIT_LS_FILES_MAX_BUFFER_BYTES, SOURCE_FILE_PATTERN } from "../constants.js";
import type {
  DependencyInfo,
  Framework,
  PackageJson,
  ProjectInfo,
  WorkspacePackage,
} from "../types.js";
import { readPackageJson } from "./read-package-json.js";

const REACT_COMPILER_PACKAGES = new Set([
  "babel-plugin-react-compiler",
  "react-compiler-runtime",
  "eslint-plugin-react-compiler",
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
  "vite.config.cjs",
];

const REACT_COMPILER_CONFIG_PATTERN = /react-compiler|reactCompiler/;
const SOURCE_COUNT_IGNORED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".hg",
  ".next",
  ".svn",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const ROBLOX_REACT_PACKAGE_NAME = "@rbxts/react";
const ROBLOX_TYPES_PACKAGE_NAME = "@rbxts/types";
const ROBLOX_TS_PACKAGE_NAME = "roblox-ts";
const ROBLOX_TS_TYPE_MARKERS = new Set([
  "@rbxts/types",
  "@rbxts/react-types",
  "@rbxts/react-roblox-types",
]);

const FRAMEWORK_PACKAGES: Record<string, Framework> = {
  next: "nextjs",
  vite: "vite",
  "react-scripts": "cra",
  "@remix-run/react": "remix",
  gatsby: "gatsby",
};

const FRAMEWORK_DISPLAY_NAMES: Record<Framework, string> = {
  nextjs: "Next.js",
  vite: "Vite",
  cra: "Create React App",
  remix: "Remix",
  gatsby: "Gatsby",
  "roblox-ts": "Roblox (roblox-ts)",
  unknown: "React",
};

export const formatFrameworkName = (framework: Framework): string =>
  FRAMEWORK_DISPLAY_NAMES[framework];

const countSourceFilesFromFilesystem = (rootDirectory: string): number => {
  const directoriesToVisit = [rootDirectory];
  let sourceFileCount = 0;

  while (directoriesToVisit.length > 0) {
    const currentDirectory = directoriesToVisit.pop();
    if (!currentDirectory) {
      continue;
    }

    let directoryEntries: fs.Dirent[] = [];
    try {
      directoryEntries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const directoryEntry of directoryEntries) {
      const entryPath = path.join(currentDirectory, directoryEntry.name);

      if (directoryEntry.isDirectory()) {
        if (SOURCE_COUNT_IGNORED_DIRECTORY_NAMES.has(directoryEntry.name)) {
          continue;
        }
        directoriesToVisit.push(entryPath);
        continue;
      }

      if (!directoryEntry.isFile()) {
        continue;
      }

      const relativePath = path.relative(rootDirectory, entryPath);
      if (SOURCE_FILE_PATTERN.test(relativePath)) {
        sourceFileCount += 1;
      }
    }
  }

  return sourceFileCount;
};

const countSourceFiles = (rootDirectory: string): number => {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: rootDirectory,
    encoding: "utf-8",
    maxBuffer: GIT_LS_FILES_MAX_BUFFER_BYTES,
  });

  if (result.error || result.status !== 0) {
    return countSourceFilesFromFilesystem(rootDirectory);
  }

  const gitSourceFileCount = result.stdout
    .split("\n")
    .filter((filePath) => filePath.length > 0 && SOURCE_FILE_PATTERN.test(filePath)).length;

  if (gitSourceFileCount > 0) {
    return gitSourceFileCount;
  }

  return countSourceFilesFromFilesystem(rootDirectory);
};

const collectAllDependencies = (packageJson: PackageJson): Record<string, string> => ({
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
});

const hasAnyRobloxTypeMarker = (types: string[]): boolean =>
  types.some((typeName) => ROBLOX_TS_TYPE_MARKERS.has(typeName));

const hasAnyRobloxTypeRoot = (typeRoots: string[]): boolean =>
  typeRoots.some((typeRoot) => typeRoot.includes("@rbxts"));

const hasRobloxToolchainDependencies = (dependencies: Record<string, string>): boolean =>
  Boolean(dependencies[ROBLOX_TYPES_PACKAGE_NAME] || dependencies[ROBLOX_TS_PACKAGE_NAME]);

const hasRobloxTsconfigTypeMarkers = (directory: string): boolean => {
  const tsconfigPath = path.join(directory, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    return false;
  }

  const tsconfigContent = fs.readFileSync(tsconfigPath, "utf-8");

  try {
    const parsedTsconfig = JSON.parse(tsconfigContent) as {
      compilerOptions?: { types?: unknown; typeRoots?: unknown };
    };
    const tsconfigTypes = parsedTsconfig.compilerOptions?.types;
    if (Array.isArray(tsconfigTypes)) {
      const typeNames = tsconfigTypes.filter((typeName) => typeof typeName === "string");
      if (hasAnyRobloxTypeMarker(typeNames)) {
        return true;
      }
    }

    const tsconfigTypeRoots = parsedTsconfig.compilerOptions?.typeRoots;
    if (Array.isArray(tsconfigTypeRoots)) {
      const typeRootNames = tsconfigTypeRoots.filter((typeRoot) => typeof typeRoot === "string");
      if (hasAnyRobloxTypeRoot(typeRootNames)) {
        return true;
      }
    }
  } catch {}

  return (
    [...ROBLOX_TS_TYPE_MARKERS].some((typeMarker) => tsconfigContent.includes(typeMarker)) ||
    (tsconfigContent.includes('"typeRoots"') && tsconfigContent.includes("@rbxts"))
  );
};

const detectFramework = (directory: string, dependencies: Record<string, string>): Framework => {
  if (
    dependencies[ROBLOX_REACT_PACKAGE_NAME] &&
    (hasRobloxTsconfigTypeMarkers(directory) || hasRobloxToolchainDependencies(dependencies))
  ) {
    return "roblox-ts";
  }

  for (const [packageName, frameworkName] of Object.entries(FRAMEWORK_PACKAGES)) {
    if (dependencies[packageName]) {
      return frameworkName;
    }
  }
  return "unknown";
};

const extractDependencyInfo = (directory: string, packageJson: PackageJson): DependencyInfo => {
  const allDependencies = collectAllDependencies(packageJson);
  return {
    reactVersion: allDependencies.react ?? allDependencies[ROBLOX_REACT_PACKAGE_NAME] ?? null,
    framework: detectFramework(directory, allDependencies),
  };
};

const parsePnpmWorkspacePatterns = (rootDirectory: string): string[] => {
  const workspacePath = path.join(rootDirectory, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspacePath)) return [];

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

const getWorkspacePatterns = (rootDirectory: string, packageJson: PackageJson): string[] => {
  const pnpmPatterns = parsePnpmWorkspacePatterns(rootDirectory);
  if (pnpmPatterns.length > 0) return pnpmPatterns;

  if (Array.isArray(packageJson.workspaces)) {
    return packageJson.workspaces;
  }

  if (packageJson.workspaces?.packages) {
    return packageJson.workspaces.packages;
  }

  return [];
};

const resolveWorkspaceDirectories = (rootDirectory: string, pattern: string): string[] => {
  const cleanPattern = pattern.replace(/["']/g, "").replace(/\/\*\*$/, "/*");

  if (!cleanPattern.includes("*")) {
    const directoryPath = path.join(rootDirectory, cleanPattern);
    if (fs.existsSync(directoryPath) && fs.existsSync(path.join(directoryPath, "package.json"))) {
      return [directoryPath];
    }
    return [];
  }

  const baseDirectory = path.join(rootDirectory, cleanPattern.slice(0, cleanPattern.indexOf("*")));

  if (!fs.existsSync(baseDirectory) || !fs.statSync(baseDirectory).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(baseDirectory)
    .map((entry) => path.join(baseDirectory, entry))
    .filter(
      (entryPath) =>
        fs.statSync(entryPath).isDirectory() && fs.existsSync(path.join(entryPath, "package.json")),
    );
};

const findDependencyInfoFromAncestors = (startDirectory: string): DependencyInfo => {
  let currentDirectory = path.dirname(startDirectory);
  const result: DependencyInfo = { reactVersion: null, framework: "unknown" };

  while (currentDirectory !== path.dirname(currentDirectory)) {
    const packageJsonPath = path.join(currentDirectory, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = readPackageJson(packageJsonPath);
      const info = extractDependencyInfo(currentDirectory, packageJson);

      if (!result.reactVersion && info.reactVersion) {
        result.reactVersion = info.reactVersion;
      }
      if (result.framework === "unknown" && info.framework !== "unknown") {
        result.framework = info.framework;
      }

      if (result.reactVersion && result.framework !== "unknown") {
        return result;
      }
    }

    currentDirectory = path.dirname(currentDirectory);
  }

  return result;
};

const findReactInWorkspaces = (rootDirectory: string, packageJson: PackageJson): DependencyInfo => {
  const patterns = getWorkspacePatterns(rootDirectory, packageJson);
  const result: DependencyInfo = { reactVersion: null, framework: "unknown" };

  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);

    for (const workspaceDirectory of directories) {
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));
      const info = extractDependencyInfo(workspaceDirectory, workspacePackageJson);

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

const hasReactDependency = (packageJson: PackageJson): boolean => {
  const allDependencies = collectAllDependencies(packageJson);
  return Object.keys(allDependencies).some(
    (packageName) => packageName === "next" || packageName.includes("react"),
  );
};

export const discoverReactSubprojects = (rootDirectory: string): WorkspacePackage[] => {
  if (!fs.existsSync(rootDirectory) || !fs.statSync(rootDirectory).isDirectory()) return [];

  const entries = fs.readdirSync(rootDirectory, { withFileTypes: true });
  const packages: WorkspacePackage[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }

    const subdirectory = path.join(rootDirectory, entry.name);
    const packageJsonPath = path.join(subdirectory, "package.json");
    if (!fs.existsSync(packageJsonPath)) continue;

    const packageJson = readPackageJson(packageJsonPath);
    if (!hasReactDependency(packageJson)) continue;

    const name = packageJson.name ?? entry.name;
    packages.push({ name, directory: subdirectory });
  }

  return packages;
};

export const listWorkspacePackages = (rootDirectory: string): WorkspacePackage[] => {
  const packageJsonPath = path.join(rootDirectory, "package.json");
  if (!fs.existsSync(packageJsonPath)) return [];

  const packageJson = readPackageJson(packageJsonPath);
  const patterns = getWorkspacePatterns(rootDirectory, packageJson);
  if (patterns.length === 0) return [];

  const packages: WorkspacePackage[] = [];

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
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  return pattern.test(content);
};

const hasCompilerInConfigFiles = (directory: string, filenames: string[]): boolean =>
  filenames.some((filename) =>
    fileContainsPattern(path.join(directory, filename), REACT_COMPILER_CONFIG_PATTERN),
  );

const detectReactCompiler = (directory: string, packageJson: PackageJson): boolean => {
  if (hasCompilerPackage(packageJson)) return true;

  if (hasCompilerInConfigFiles(directory, NEXT_CONFIG_FILENAMES)) return true;
  if (hasCompilerInConfigFiles(directory, BABEL_CONFIG_FILENAMES)) return true;
  if (hasCompilerInConfigFiles(directory, VITE_CONFIG_FILENAMES)) return true;

  let ancestorDirectory = path.dirname(directory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorPackagePath = path.join(ancestorDirectory, "package.json");
    if (fs.existsSync(ancestorPackagePath)) {
      const ancestorPackageJson = readPackageJson(ancestorPackagePath);
      if (hasCompilerPackage(ancestorPackageJson)) return true;
    }
    ancestorDirectory = path.dirname(ancestorDirectory);
  }

  return false;
};

interface DiscoverProjectOptions {
  frameworkOverride?: Framework;
}

export const discoverProject = (
  directory: string,
  options: DiscoverProjectOptions = {},
): ProjectInfo => {
  const packageJsonPath = path.join(directory, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`No package.json found in ${directory}`);
  }

  const packageJson = readPackageJson(packageJsonPath);
  let { reactVersion, framework } = extractDependencyInfo(directory, packageJson);

  if (!reactVersion || framework === "unknown") {
    const workspaceInfo = findReactInWorkspaces(directory, packageJson);
    if (!reactVersion && workspaceInfo.reactVersion) {
      reactVersion = workspaceInfo.reactVersion;
    }
    if (framework === "unknown" && workspaceInfo.framework !== "unknown") {
      framework = workspaceInfo.framework;
    }
  }

  if (!reactVersion || framework === "unknown") {
    const ancestorInfo = findDependencyInfoFromAncestors(directory);
    if (!reactVersion) {
      reactVersion = ancestorInfo.reactVersion;
    }
    if (framework === "unknown") {
      framework = ancestorInfo.framework;
    }
  }

  const projectName = packageJson.name ?? path.basename(directory);
  const hasTypeScript = fs.existsSync(path.join(directory, "tsconfig.json"));
  const sourceFileCount = countSourceFiles(directory);

  const hasReactCompiler = detectReactCompiler(directory, packageJson);

  return {
    rootDirectory: directory,
    projectName,
    reactVersion,
    framework: options.frameworkOverride ?? framework,
    hasTypeScript,
    hasReactCompiler,
    sourceFileCount,
  };
};
