import * as path from "node:path";
import { IGNORED_DIRECTORIES } from "./constants.js";
import type { PackageJson, WorkspacePackage } from "../types/index.js";
import { isDirectory, isFile, readDirectoryEntries } from "./fs-utils.js";
import { hasReactDependency } from "./dependencies.js";
import { readPackageJson } from "./package-json.js";
import {
  getNxWorkspaceDirectories,
  listWorkspacePackages,
  parsePnpmWorkspacePatterns,
  resolveWorkspaceDirectories,
} from "./workspaces.js";

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

// Directory names that hold OS- or editor-managed installs rather than user
// projects. When a scan starts from a home directory (no package.json and no
// workspace manifest in cwd), the recursive crawl would otherwise descend into
// these and surface vendored React packages that the user never authored — e.g.
// VS Code ships a `copilot` extension under `AppData` that declares a React
// dependency, which made `react-doctor` report ambiguous candidates. See #545.
const NON_PROJECT_DIRECTORIES = new Set([
  "AppData", // Windows per-user app data + bundled application installs
  "Application Data", // legacy Windows app-data junction
  "Library", // macOS per-user app data, caches, and app installs
]);

// Backstop for pathological trees: real projects discovered via filesystem
// fallback (only used when the scan root has no package.json / workspace
// manifest) sit a few levels down at most. Bounding the depth keeps the crawl
// from descending deep into vendored installs that escape the name list above.
const MAX_SCAN_DEPTH = 6;

const discoverReactSubprojectsByFilesystem = (rootDirectory: string): WorkspacePackage[] => {
  const packages: WorkspacePackage[] = [];
  // HACK: stack + .pop() rather than queue + .shift() because Array.shift()
  // is O(n), which degraded this walk to O(n^2) on large trees. Sibling
  // walks in list-source-files / resolve-lint-include-paths use the same
  // stack pattern. Result is the same set of directories with a different
  // visit order (depth-first instead of breadth-first), which doesn't
  // matter for the final packages list.
  const pendingDirectories: { directory: string; depth: number }[] = [
    { directory: rootDirectory, depth: 0 },
  ];

  while (pendingDirectories.length > 0) {
    const current = pendingDirectories.pop();
    if (!current) continue;

    const { directory: currentDirectory, depth } = current;
    const packageJsonPath = path.join(currentDirectory, "package.json");
    if (isFile(packageJsonPath)) {
      const packageJson = readPackageJson(packageJsonPath);
      if (hasReactDependency(packageJson)) {
        const name = packageJson.name ?? path.basename(currentDirectory);
        packages.push({ name, directory: currentDirectory });
      }
    }

    if (depth >= MAX_SCAN_DEPTH) continue;

    const entries = readDirectoryEntries(currentDirectory).toSorted((firstEntry, secondEntry) =>
      firstEntry.name.localeCompare(secondEntry.name),
    );

    for (const entry of entries) {
      if (
        !entry.isDirectory() ||
        entry.name.startsWith(".") ||
        IGNORED_DIRECTORIES.has(entry.name) ||
        NON_PROJECT_DIRECTORIES.has(entry.name)
      ) {
        continue;
      }

      pendingDirectories.push({
        directory: path.join(currentDirectory, entry.name),
        depth: depth + 1,
      });
    }
  }

  return packages;
};

export const discoverReactSubprojects = (rootDirectory: string): WorkspacePackage[] => {
  if (!isDirectory(rootDirectory)) return [];

  const manifestPackages = listManifestWorkspacePackages(rootDirectory);
  if (manifestPackages.length > 0) return manifestPackages;

  return discoverReactSubprojectsByFilesystem(rootDirectory);
};
