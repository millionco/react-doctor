import path from "node:path";
import type { DependencyInfo } from "../types/index.js";
import { isFile } from "./utils/is-file.js";
import { EMPTY_DEPENDENCY_INFO, extractDependencyInfo } from "./extract-dependency-info.js";
import { findMonorepoRoot } from "./find-monorepo-root.js";
import { findReactInWorkspaces } from "./find-react-in-workspaces.js";
import { getDependencyDeclaration } from "./utils/get-dependency-declaration.js";
import { readPackageJson } from "./read-package-json.js";
import { resolveCatalogVersion } from "./resolve-catalog-version.js";

export const findDependencyInfoFromMonorepoRoot = (directory: string): DependencyInfo => {
  const monorepoRoot = findMonorepoRoot(directory);
  if (!monorepoRoot) return EMPTY_DEPENDENCY_INFO;

  const monorepoPackageJsonPath = path.join(monorepoRoot, "package.json");
  if (!isFile(monorepoPackageJsonPath)) return EMPTY_DEPENDENCY_INFO;

  const rootPackageJson = readPackageJson(monorepoPackageJsonPath);
  const rootInfo = extractDependencyInfo(rootPackageJson);
  const leafPackageJsonPath = path.join(directory, "package.json");
  const leafPackageJson = isFile(leafPackageJsonPath) ? readPackageJson(leafPackageJsonPath) : null;
  const leafReactDeclaration = leafPackageJson
    ? getDependencyDeclaration({
        packageJson: leafPackageJson,
        packageName: "react",
        sections: ["dependencies", "peerDependencies", "devDependencies"],
      })
    : null;
  const leafTailwindDeclaration = leafPackageJson
    ? getDependencyDeclaration({
        packageJson: leafPackageJson,
        packageName: "tailwindcss",
        sections: ["dependencies", "devDependencies", "peerDependencies"],
      })
    : null;
  const shouldUseReactFallback = !leafReactDeclaration?.hasDeclaration;
  const shouldUseTailwindFallback = leafTailwindDeclaration?.hasDeclaration ?? true;
  const reactCatalogVersion = shouldUseReactFallback
    ? resolveCatalogVersion(
        rootPackageJson,
        "react",
        monorepoRoot,
        leafReactDeclaration?.catalogReference,
      )
    : null;
  const tailwindCatalogVersion = shouldUseTailwindFallback
    ? resolveCatalogVersion(
        rootPackageJson,
        "tailwindcss",
        monorepoRoot,
        leafTailwindDeclaration?.catalogReference,
      )
    : null;
  const workspaceInfo = findReactInWorkspaces(monorepoRoot, rootPackageJson);

  return {
    reactVersion: shouldUseReactFallback
      ? (reactCatalogVersion ?? rootInfo.reactVersion ?? workspaceInfo.reactVersion)
      : (rootInfo.reactVersion ?? workspaceInfo.reactVersion),
    tailwindVersion: shouldUseTailwindFallback
      ? (tailwindCatalogVersion ?? rootInfo.tailwindVersion ?? workspaceInfo.tailwindVersion)
      : null,
    framework: rootInfo.framework !== "unknown" ? rootInfo.framework : workspaceInfo.framework,
  };
};
