import fs from "node:fs";
import path from "node:path";
import { PackageJsonNotFoundError } from "../errors.js";
import type { ProjectInfo } from "../types/project-info.js";
import { isFile } from "./is-file.js";
import { collectAllDependencies } from "./collect-all-dependencies.js";
import { countSourceFiles } from "./count-source-files.js";
import { detectReactCompiler } from "./detect-react-compiler.js";
import { extractDependencyInfo } from "./extract-dependency-info.js";
import { findDependencyInfoFromMonorepoRoot } from "./find-dependency-info-from-monorepo-root.js";
import { findMonorepoRoot, isMonorepoRoot } from "./find-monorepo-root.js";
import { findReactInWorkspaces } from "./find-react-in-workspaces.js";
import { hasTanStackQuery } from "./has-tanstack-query.js";
import { getCachedProject, setCachedProject } from "./project-cache.js";
import { readPackageJson } from "./read-package-json.js";
import { extractCatalogName, resolveCatalogVersion } from "./resolve-catalog-version.js";
import { resolveEffectiveReactMajor } from "./resolve-effective-react-major.js";

export { clearProjectCache } from "./project-cache.js";
export { discoverReactSubprojects } from "./discover-react-subprojects.js";
export { formatFrameworkName } from "./detect-framework.js";
export { listWorkspacePackages } from "./list-workspace-packages.js";

export const discoverProject = (directory: string): ProjectInfo => {
  const cached = getCachedProject(directory);
  if (cached !== undefined) return cached;

  const packageJsonPath = path.join(directory, "package.json");
  if (!isFile(packageJsonPath)) {
    throw new PackageJsonNotFoundError(directory);
  }

  const packageJson = readPackageJson(packageJsonPath);
  let { reactVersion, tailwindVersion, framework } = extractDependencyInfo(packageJson);

  // HACK: capture the catalog reference (e.g. `catalog:react19`) from
  // the LEAF package once so every fallback resolver below can route
  // named-catalog lookups to the right group, even when the root
  // package.json has no `react` dependency to derive a name from.
  const leafDependencies = collectAllDependencies(packageJson);
  const leafReactCatalogReference = extractCatalogName(leafDependencies.react ?? "") ?? null;
  const leafTailwindCatalogReference =
    extractCatalogName(leafDependencies.tailwindcss ?? "") ?? null;

  if (!reactVersion) {
    reactVersion = resolveCatalogVersion(
      packageJson,
      "react",
      directory,
      leafReactCatalogReference,
    );
  }

  if (!tailwindVersion) {
    tailwindVersion = resolveCatalogVersion(
      packageJson,
      "tailwindcss",
      directory,
      leafTailwindCatalogReference,
    );
  }

  // HACK: gate the cheap monorepo-root catalog read on either dep
  // missing — it's a single readPackageJson + parsePnpmWorkspaceCatalogs
  // call, free to run opportunistically for Tailwind in a non-Tailwind
  // project. The expensive walks below (findReactInWorkspaces,
  // findDependencyInfoFromMonorepoRoot) intentionally do NOT include
  // `!tailwindVersion` in their gates — those iterate every workspace
  // package.json, which a React-only monorepo with hundreds of
  // workspace packages should not pay the cost of just to confirm
  // Tailwind isn't there.
  if (!reactVersion || !tailwindVersion) {
    const monorepoRoot = findMonorepoRoot(directory);
    if (monorepoRoot) {
      const monorepoPackageJsonPath = path.join(monorepoRoot, "package.json");
      if (isFile(monorepoPackageJsonPath)) {
        const rootPackageJson = readPackageJson(monorepoPackageJsonPath);
        if (!reactVersion) {
          reactVersion = resolveCatalogVersion(
            rootPackageJson,
            "react",
            monorepoRoot,
            leafReactCatalogReference,
          );
        }
        if (!tailwindVersion) {
          tailwindVersion = resolveCatalogVersion(
            rootPackageJson,
            "tailwindcss",
            monorepoRoot,
            leafTailwindCatalogReference,
          );
        }
      }
    }
  }

  if (!reactVersion || framework === "unknown") {
    const workspaceInfo = findReactInWorkspaces(directory, packageJson);
    if (!reactVersion && workspaceInfo.reactVersion) {
      reactVersion = workspaceInfo.reactVersion;
    }
    if (!tailwindVersion && workspaceInfo.tailwindVersion) {
      tailwindVersion = workspaceInfo.tailwindVersion;
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
    if (!tailwindVersion) {
      tailwindVersion = monorepoInfo.tailwindVersion;
    }
    if (framework === "unknown") {
      framework = monorepoInfo.framework;
    }
  }

  const projectName = packageJson.name ?? path.basename(directory);
  const hasTypeScript = fs.existsSync(path.join(directory, "tsconfig.json"));
  const sourceFileCount = countSourceFiles(directory);

  const projectInfo: ProjectInfo = {
    rootDirectory: directory,
    projectName,
    reactVersion,
    reactMajorVersion: resolveEffectiveReactMajor(reactVersion, packageJson),
    tailwindVersion,
    framework,
    hasTypeScript,
    hasReactCompiler: detectReactCompiler(directory, packageJson),
    hasTanStackQuery: hasTanStackQuery(packageJson),
    sourceFileCount,
  };
  setCachedProject(directory, projectInfo);
  return projectInfo;
};
