import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SOURCE_FILE_PATTERN } from "../constants.js";
import type { Framework, ProjectInfo } from "../types.js";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

interface DependencyInfo {
  reactVersion: string | null;
  framework: Framework;
}

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
  unknown: "React",
};

export const formatFrameworkName = (framework: Framework): string =>
  FRAMEWORK_DISPLAY_NAMES[framework];

const countSourceFiles = (rootDirectory: string): number => {
  const result = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: rootDirectory,
    encoding: "utf-8",
  });

  if (result.error || result.status !== 0) {
    return 0;
  }

  return result.stdout
    .split("\n")
    .filter((filePath) => filePath.length > 0 && SOURCE_FILE_PATTERN.test(filePath)).length;
};

const detectFramework = (
  dependencies: Record<string, string>,
): Framework => {
  for (const [packageName, frameworkName] of Object.entries(FRAMEWORK_PACKAGES)) {
    if (dependencies[packageName]) {
      return frameworkName;
    }
  }
  return "unknown";
};

const extractDependencyInfo = (
  packageJson: PackageJson,
): DependencyInfo => {
  const allDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  return {
    reactVersion: allDependencies.react ?? null,
    framework: detectFramework(allDependencies),
  };
};

const parsePnpmWorkspacePatterns = (
  rootDirectory: string,
): string[] => {
  const workspacePath = path.join(rootDirectory, "pnpm-workspace.yaml");
  if (!fs.existsSync(workspacePath)) return [];

  const content = fs.readFileSync(workspacePath, "utf-8");
  const patterns: string[] = [];
  let insidePackagesBlock = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "packages:") {
      insidePackagesBlock = true;
      continue;
    }
    if (insidePackagesBlock && trimmed.startsWith("-")) {
      patterns.push(trimmed.replace(/^-\s*/, "").replace(/["']/g, ""));
    } else if (insidePackagesBlock && trimmed.length > 0 && !trimmed.startsWith("#")) {
      insidePackagesBlock = false;
    }
  }

  return patterns;
};

const getWorkspacePatterns = (
  rootDirectory: string,
  packageJson: PackageJson,
): string[] => {
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

const resolveWorkspaceDirectories = (
  rootDirectory: string,
  pattern: string,
): string[] => {
  const cleanPattern = pattern.replace(/["']/g, "").replace(/\/\*\*$/, "/*");

  if (!cleanPattern.includes("*")) {
    const directoryPath = path.join(rootDirectory, cleanPattern);
    if (
      fs.existsSync(directoryPath) &&
      fs.existsSync(path.join(directoryPath, "package.json"))
    ) {
      return [directoryPath];
    }
    return [];
  }

  const baseDirectory = path.join(
    rootDirectory,
    cleanPattern.slice(0, cleanPattern.indexOf("*")),
  );

  if (!fs.existsSync(baseDirectory) || !fs.statSync(baseDirectory).isDirectory()) {
    return [];
  }

  return fs
    .readdirSync(baseDirectory)
    .map((entry) => path.join(baseDirectory, entry))
    .filter(
      (entryPath) =>
        fs.statSync(entryPath).isDirectory() &&
        fs.existsSync(path.join(entryPath, "package.json")),
    );
};

const findReactInWorkspaces = (
  rootDirectory: string,
  packageJson: PackageJson,
): DependencyInfo => {
  const patterns = getWorkspacePatterns(rootDirectory, packageJson);
  const result: DependencyInfo = { reactVersion: null, framework: "unknown" };

  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);

    for (const workspaceDirectory of directories) {
      const workspacePackageJson = JSON.parse(
        fs.readFileSync(path.join(workspaceDirectory, "package.json"), "utf-8"),
      ) as PackageJson;
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

export const discoverProject = (directory: string): ProjectInfo => {
  const packageJsonPath = path.join(directory, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`No package.json found in ${directory}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as PackageJson;
  let { reactVersion, framework } = extractDependencyInfo(packageJson);

  if (!reactVersion) {
    const workspaceInfo = findReactInWorkspaces(directory, packageJson);
    reactVersion = workspaceInfo.reactVersion;
    framework = workspaceInfo.framework;
  } else if (framework === "unknown") {
    const workspaceInfo = findReactInWorkspaces(directory, packageJson);
    if (workspaceInfo.framework !== "unknown") {
      framework = workspaceInfo.framework;
    }
  }

  const hasTypeScript = fs.existsSync(path.join(directory, "tsconfig.json"));
  const sourceFileCount = countSourceFiles(directory);

  return {
    rootDirectory: directory,
    reactVersion,
    framework,
    hasTypeScript,
    sourceFileCount,
  };
};
