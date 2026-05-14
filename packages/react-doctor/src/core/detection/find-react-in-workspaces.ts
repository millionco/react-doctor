import path from "node:path";
import type { DependencyInfo, PackageJson } from "../../types.js";
import { EMPTY_DEPENDENCY_INFO, extractDependencyInfo } from "./extract-dependency-info.js";
import { getWorkspacePatterns } from "./get-workspace-patterns.js";
import { readPackageJson } from "./read-package-json.js";
import { resolveWorkspaceDirectories } from "./resolve-workspace-directories.js";

export const findReactInWorkspaces = (
  rootDirectory: string,
  packageJson: PackageJson,
): DependencyInfo => {
  const patterns = getWorkspacePatterns(rootDirectory, packageJson);
  const result: DependencyInfo = { ...EMPTY_DEPENDENCY_INFO };

  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);

    for (const workspaceDirectory of directories) {
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));
      const info = extractDependencyInfo(workspacePackageJson);

      if (info.reactVersion && !result.reactVersion) {
        result.reactVersion = info.reactVersion;
      }
      if (info.tailwindVersion && !result.tailwindVersion) {
        result.tailwindVersion = info.tailwindVersion;
      }
      if (info.framework !== "unknown" && result.framework === "unknown") {
        result.framework = info.framework;
      }

      // HACK: deliberately don't add `result.tailwindVersion` to the
      // early-exit predicate. Tailwind is collected opportunistically
      // here — but a non-Tailwind monorepo would never satisfy that
      // gate, forcing us to read every workspace package.json on every
      // scan. The hot path (react-only project, possibly large
      // monorepo) keeps the original short-circuit; Tailwind users
      // either declare it on the leaf (no walk needed) or via a
      // catalog at the monorepo root (resolved by the cheap
      // resolveCatalogVersion path before this fallback even runs).
      if (result.reactVersion && result.framework !== "unknown") {
        return result;
      }
    }
  }

  return result;
};
