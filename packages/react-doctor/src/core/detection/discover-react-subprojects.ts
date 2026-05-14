import fs from "node:fs";
import path from "node:path";
import { IGNORED_DIRECTORIES } from "../../constants.js";
import type { PackageJson, WorkspacePackage } from "../../types.js";
import { isFile } from "../is-file.js";
import { getNxWorkspaceDirectories } from "./get-nx-workspace-directories.js";
import { hasReactDependency } from "./has-react-dependency.js";
import { listWorkspacePackages } from "./list-workspace-packages.js";
import { parsePnpmWorkspacePatterns } from "./parse-pnpm-workspace-patterns.js";
import { readPackageJson } from "./read-package-json.js";
import { resolveWorkspaceDirectories } from "./resolve-workspace-directories.js";

const toReactWorkspacePackages = (directories: string[]): WorkspacePackage[] => {
  const packages: WorkspacePackage[] = [];

  for (const directory of directories) {
    const packageJsonPath = path.join(directory, "package.json");
    if (!isFile(packageJsonPath)) continue;

    const packageJson: PackageJson = readPackageJson(packageJsonPath);
    if (!hasReactDependency(packageJson)) continue;

    const name = packageJson.name ?? path.basename(directory);
    packages.push({ name, directory });
  }

  return packages;
};

const listManifestWorkspacePackages = (rootDirectory: string): WorkspacePackage[] => {
  const packageJsonPath = path.join(rootDirectory, "package.json");
  if (isFile(packageJsonPath)) return listWorkspacePackages(rootDirectory);

  const patterns = parsePnpmWorkspacePatterns(rootDirectory);
  const nxPatterns = patterns.length > 0 ? [] : getNxWorkspaceDirectories(rootDirectory);
  const directories = (patterns.length > 0 ? patterns : nxPatterns).flatMap((pattern) =>
    resolveWorkspaceDirectories(rootDirectory, pattern),
  );

  return toReactWorkspacePackages(directories);
};

const discoverReactSubprojectsByFilesystem = (rootDirectory: string): WorkspacePackage[] => {
  const packages: WorkspacePackage[] = [];
  const pendingDirectories = [rootDirectory];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.shift();
    if (!currentDirectory) continue;

    const packageJsonPath = path.join(currentDirectory, "package.json");
    if (isFile(packageJsonPath)) {
      const packageJson = readPackageJson(packageJsonPath);
      if (hasReactDependency(packageJson)) {
        const name = packageJson.name ?? path.basename(currentDirectory);
        packages.push({ name, directory: currentDirectory });
      }
    }

    const entries = fs
      .readdirSync(currentDirectory, { withFileTypes: true })
      .toSorted((firstEntry, secondEntry) => firstEntry.name.localeCompare(secondEntry.name));

    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith(".") ||
        IGNORED_DIRECTORIES.has(entry.name)
      ) {
        continue;
      }

      pendingDirectories.push(path.join(currentDirectory, entry.name));
    }
  }

  return packages;
};

export const discoverReactSubprojects = (rootDirectory: string): WorkspacePackage[] => {
  if (!fs.existsSync(rootDirectory) || !fs.statSync(rootDirectory).isDirectory()) return [];

  const manifestPackages = listManifestWorkspacePackages(rootDirectory);
  if (manifestPackages.length > 0) return manifestPackages;

  return discoverReactSubprojectsByFilesystem(rootDirectory);
};
