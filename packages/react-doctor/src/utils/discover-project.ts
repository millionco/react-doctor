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
import { findMonorepoRoot, isMonorepoRoot } from "./find-monorepo-root.js";
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

const EXPO_APP_CONFIG_FILENAMES = ["app.json", "app.config.js", "app.config.ts"];

const REACT_COMPILER_CONFIG_PATTERN = /react-compiler|reactCompiler/;

const FRAMEWORK_PACKAGES: Record<string, Framework> = {
  next: "nextjs",
  vite: "vite",
  "react-scripts": "cra",
  "@remix-run/react": "remix",
  gatsby: "gatsby",
  expo: "expo",
  "react-native": "react-native",
};

const FRAMEWORK_DISPLAY_NAMES: Record<Framework, string> = {
  nextjs: "Next.js",
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

const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage"]);

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
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: rootDirectory,
    encoding: "utf-8",
    maxBuffer: GIT_LS_FILES_MAX_BUFFER_BYTES,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout
    .split("\n")
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

const extractDependencyInfo = (packageJson: PackageJson): DependencyInfo => {
  const allDependencies = collectAllDependencies(packageJson);
  return {
    reactVersion: allDependencies.react ?? null,
    framework: detectFramework(allDependencies),
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
        fs.existsSync(path.join(entryPath, "package.json")),
    );
};

const findDependencyInfoFromMonorepoRoot = (directory: string): DependencyInfo => {
  const monorepoRoot = findMonorepoRoot(directory);
  if (!monorepoRoot) return { reactVersion: null, framework: "unknown" };

  const rootPackageJson = readPackageJson(path.join(monorepoRoot, "package.json"));
  const rootInfo = extractDependencyInfo(rootPackageJson);
  const workspaceInfo = findReactInWorkspaces(monorepoRoot, rootPackageJson);

  return {
    reactVersion: rootInfo.reactVersion ?? workspaceInfo.reactVersion,
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
  if (fs.existsSync(rootPackageJsonPath)) {
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
  if (hasCompilerInConfigFiles(directory, EXPO_APP_CONFIG_FILENAMES)) return true;

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

export const discoverProject = (directory: string): ProjectInfo => {
  const packageJsonPath = path.join(directory, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`No package.json found in ${directory}`);
  }

  const packageJson = readPackageJson(packageJsonPath);
  let { reactVersion, framework } = extractDependencyInfo(packageJson);

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

  return {
    rootDirectory: directory,
    projectName,
    reactVersion,
    framework,
    hasTypeScript,
    hasReactCompiler,
    sourceFileCount,
  };
};
