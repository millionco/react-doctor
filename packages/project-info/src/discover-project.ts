import fs from "node:fs";
import path from "node:path";
import { PackageJsonNotFoundError } from "./errors.js";
import type { ProjectInfo } from "@react-doctor/types";
import { isFile } from "./utils/is-file.js";
import { countSourceFiles } from "./count-source-files.js";
import { detectReactCompiler } from "./detect-react-compiler.js";
import { extractDependencyInfo } from "./extract-dependency-info.js";
import { findDependencyInfoFromMonorepoRoot } from "./find-dependency-info-from-monorepo-root.js";
import { findMonorepoRoot, isMonorepoRoot } from "./find-monorepo-root.js";
import { findReactInWorkspaces } from "./find-react-in-workspaces.js";
import { getDependencyDeclaration } from "./utils/get-dependency-declaration.js";
import { hasReactNativeWorkspaceAnywhere } from "./has-react-native-workspace-anywhere.js";
import { hasTanStackQuery } from "./has-tanstack-query.js";
import { readPackageJson } from "./read-package-json.js";
import { isCatalogReference, resolveCatalogVersion } from "./resolve-catalog-version.js";
import { resolveEffectiveReactMajor } from "./resolve-effective-react-major.js";

export { discoverReactSubprojects } from "./discover-react-subprojects.js";
export { formatFrameworkName } from "./detect-framework.js";
export { listWorkspacePackages } from "./list-workspace-packages.js";

const cachedProjectInfos = new Map<string, ProjectInfo>();

// HACK: paired with clearConfigCache — exposed so programmatic API
// consumers can re-detect after the project's package.json /
// tsconfig.json / monorepo manifests change between diagnose() calls.
export const clearProjectCache = (): void => {
  cachedProjectInfos.clear();
};

export const discoverProject = (directory: string): ProjectInfo => {
  const cached = cachedProjectInfos.get(directory);
  if (cached !== undefined) return cached;

  const packageJsonPath = path.join(directory, "package.json");
  if (!isFile(packageJsonPath)) {
    throw new PackageJsonNotFoundError(directory);
  }

  const packageJson = readPackageJson(packageJsonPath);
  let { reactVersion, tailwindVersion, framework } = extractDependencyInfo(packageJson);

  const reactDeclaration = getDependencyDeclaration({
    packageJson,
    packageName: "react",
    sections: ["dependencies", "peerDependencies", "devDependencies"],
  });
  const tailwindDeclaration = getDependencyDeclaration({
    packageJson,
    packageName: "tailwindcss",
    sections: ["dependencies", "devDependencies", "peerDependencies"],
  });

  if (!reactVersion && reactDeclaration.hasDeclaration) {
    reactVersion = resolveCatalogVersion(
      packageJson,
      "react",
      directory,
      reactDeclaration.catalogReference,
    );
  }

  if (!tailwindVersion && tailwindDeclaration.hasDeclaration) {
    tailwindVersion = resolveCatalogVersion(
      packageJson,
      "tailwindcss",
      directory,
      tailwindDeclaration.catalogReference,
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
        if (!reactVersion && reactDeclaration.hasDeclaration) {
          reactVersion = resolveCatalogVersion(
            rootPackageJson,
            "react",
            monorepoRoot,
            reactDeclaration.catalogReference,
          );
        }
        if (!tailwindVersion && tailwindDeclaration.hasDeclaration) {
          tailwindVersion = resolveCatalogVersion(
            rootPackageJson,
            "tailwindcss",
            monorepoRoot,
            tailwindDeclaration.catalogReference,
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

  if (!reactVersion && reactDeclaration.version && !isCatalogReference(reactDeclaration.version)) {
    reactVersion = reactDeclaration.version;
  }
  if (
    !tailwindVersion &&
    tailwindDeclaration.version &&
    !isCatalogReference(tailwindDeclaration.version)
  ) {
    tailwindVersion = tailwindDeclaration.version;
  }

  const projectName = packageJson.name ?? path.basename(directory);
  const hasTypeScript = fs.existsSync(path.join(directory, "tsconfig.json"));
  const sourceFileCount = countSourceFiles(directory);

  // The capability gate in `buildCapabilities` keys off this bit so
  // `rn-*` rules also load on web-rooted monorepos (a `next` root
  // with an `apps/mobile` Expo workspace, etc.). Skip the workspace
  // walk when the root itself already classifies as RN — the bit is
  // trivially true in that case.
  const hasReactNativeWorkspace =
    framework === "expo" ||
    framework === "react-native" ||
    hasReactNativeWorkspaceAnywhere(directory, packageJson);

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
    hasReactNativeWorkspace,
    sourceFileCount,
  };
  cachedProjectInfos.set(directory, projectInfo);
  return projectInfo;
};
