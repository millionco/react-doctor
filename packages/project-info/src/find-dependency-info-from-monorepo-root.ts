import path from "node:path";
import type { DependencyInfo } from "@react-doctor/types";
import { isFile } from "./utils/is-file.js";
import { EMPTY_DEPENDENCY_INFO, extractDependencyInfo } from "./extract-dependency-info.js";
import { findMonorepoRoot } from "./find-monorepo-root.js";
import { findReactInWorkspaces } from "./find-react-in-workspaces.js";
import { readPackageJson } from "./read-package-json.js";
import { extractCatalogName, resolveCatalogVersion } from "./resolve-catalog-version.js";

export const findDependencyInfoFromMonorepoRoot = (directory: string): DependencyInfo => {
  const monorepoRoot = findMonorepoRoot(directory);
  if (!monorepoRoot) return EMPTY_DEPENDENCY_INFO;

  const monorepoPackageJsonPath = path.join(monorepoRoot, "package.json");
  if (!isFile(monorepoPackageJsonPath)) return EMPTY_DEPENDENCY_INFO;

  const rootPackageJson = readPackageJson(monorepoPackageJsonPath);
  const rootInfo = extractDependencyInfo(rootPackageJson);
  const leafPackageJsonPath = path.join(directory, "package.json");
  const leafPackageJson = isFile(leafPackageJsonPath) ? readPackageJson(leafPackageJsonPath) : null;
  const leafDependencies = leafPackageJson
    ? {
        ...leafPackageJson.peerDependencies,
        ...leafPackageJson.dependencies,
        ...leafPackageJson.devDependencies,
      }
    : {};
  const leafReactCatalogReference = extractCatalogName(leafDependencies.react ?? "") ?? null;
  const leafTailwindCatalogReference =
    extractCatalogName(leafDependencies.tailwindcss ?? "") ?? null;
  const reactCatalogVersion = resolveCatalogVersion(
    rootPackageJson,
    "react",
    monorepoRoot,
    leafReactCatalogReference,
  );
  const tailwindCatalogVersion = resolveCatalogVersion(
    rootPackageJson,
    "tailwindcss",
    monorepoRoot,
    leafTailwindCatalogReference,
  );
  const workspaceInfo = findReactInWorkspaces(monorepoRoot, rootPackageJson);

  return {
    reactVersion: rootInfo.reactVersion ?? reactCatalogVersion ?? workspaceInfo.reactVersion,
    tailwindVersion:
      rootInfo.tailwindVersion ?? tailwindCatalogVersion ?? workspaceInfo.tailwindVersion,
    framework: rootInfo.framework !== "unknown" ? rootInfo.framework : workspaceInfo.framework,
  };
};
