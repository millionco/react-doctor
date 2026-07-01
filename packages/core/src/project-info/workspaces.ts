import * as fs from "node:fs";
import * as path from "node:path";
import type { PackageJson, WorkspacePackage } from "../types/index.js";
import { hasReactDependency } from "./dependencies.js";
import { isDirectory, isFile, readDirectoryEntries } from "./fs-utils.js";
import { readPackageJson } from "./package-json.js";

export const getWorkspacePatterns = (rootDirectory: string, packageJson: PackageJson): string[] => {
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

export const parsePnpmWorkspacePatterns = (rootDirectory: string): string[] => {
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

export const getNxWorkspaceDirectories = (rootDirectory: string): string[] => {
  if (!isFile(path.join(rootDirectory, "nx.json"))) return [];

  const collected: string[] = [];
  for (const candidate of NX_PROJECT_DISCOVERY_DIRS) {
    const candidatePath = path.join(rootDirectory, candidate);
    if (!isDirectory(candidatePath)) continue;
    for (const entry of readDirectoryEntries(candidatePath)) {
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

export const resolveWorkspaceDirectories = (rootDirectory: string, pattern: string): string[] => {
  const cleanPattern = pattern.replace(/["']/g, "").replace(/\/\*\*$/, "/*");

  if (!cleanPattern.includes("*")) {
    const directoryPath = path.join(rootDirectory, cleanPattern);
    if (isDirectory(directoryPath) && isFile(path.join(directoryPath, "package.json"))) {
      return [directoryPath];
    }
    return [];
  }

  const wildcardIndex = cleanPattern.indexOf("*");
  const baseDirectory = path.join(rootDirectory, cleanPattern.slice(0, wildcardIndex));
  const suffixAfterWildcard = cleanPattern.slice(wildcardIndex + 1);

  if (!isDirectory(baseDirectory)) {
    return [];
  }

  const resolved: string[] = [];
  for (const entry of readDirectoryEntries(baseDirectory)) {
    const entryPath = path.join(baseDirectory, entry.name, suffixAfterWildcard);
    if (isDirectory(entryPath) && isFile(path.join(entryPath, "package.json"))) {
      resolved.push(entryPath);
    }
  }
  return resolved;
};

export const listWorkspacePackages = (rootDirectory: string): WorkspacePackage[] => {
  const packageJsonPath = path.join(rootDirectory, "package.json");
  if (!isFile(packageJsonPath)) return [];

  const packageJson = readPackageJson(packageJsonPath);
  const patterns = getWorkspacePatterns(rootDirectory, packageJson);
  if (patterns.length === 0) return [];

  const packages: WorkspacePackage[] = [];
  // HACK: workspace pattern lists routinely contain overlapping globs
  // (e.g. cal.com's `["packages/*", "packages/app-store"]`). Without
  // dedup-by-directory the same package would surface twice in
  // discovery and downstream every diagnostic for it would be emitted
  // twice. The seen-set is keyed on the absolute directory path so
  // symbolic naming via package.json#name can't accidentally collapse
  // two genuinely-distinct directories.
  const seenDirectories = new Set<string>();
  const pushIfNew = (workspacePackage: WorkspacePackage): void => {
    if (seenDirectories.has(workspacePackage.directory)) return;
    seenDirectories.add(workspacePackage.directory);
    packages.push(workspacePackage);
  };

  if (hasReactDependency(packageJson)) {
    const rootName = packageJson.name ?? path.basename(rootDirectory);
    pushIfNew({ name: rootName, directory: rootDirectory });
  }

  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);
    for (const workspaceDirectory of directories) {
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));

      if (!hasReactDependency(workspacePackageJson)) continue;

      const name = workspacePackageJson.name ?? path.basename(workspaceDirectory);
      pushIfNew({ name, directory: workspaceDirectory });
    }
  }

  return packages;
};
