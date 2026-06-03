import * as fs from "node:fs";
import * as path from "node:path";
import { PackageJsonNotFoundError } from "./errors.js";
import type { ProjectInfo } from "../types/index.js";
import { isFile } from "./utils/is-file.js";
import { countSourceFiles } from "./count-source-files.js";
import { detectReactCompiler } from "./detect-react-compiler.js";
import { extractDependencyInfo } from "./extract-dependency-info.js";
import { findDependencyInfoFromMonorepoRoot } from "./find-dependency-info-from-monorepo-root.js";
import { findMonorepoRoot, isMonorepoRoot } from "./find-monorepo-root.js";
import { findReactInWorkspaces } from "./find-react-in-workspaces.js";
import { getDependencyDeclaration } from "./utils/get-dependency-declaration.js";
import { hasReactNativeWorkspaceAnywhere } from "./has-react-native-workspace-anywhere.js";
import { findExpoVersion } from "./find-expo-version.js";
import { getPreactVersion } from "./get-preact-version.js";
import { hasTanStackQuery } from "./has-tanstack-query.js";
import { someWorkspacePackageJson } from "./some-workspace-package-json.js";
import { isPackageJsonReanimatedAware } from "./utils/is-package-json-reanimated-aware.js";
import { readPackageJson } from "./read-package-json.js";
import {
  extractCatalogName,
  isCatalogReference,
  resolveCatalogVersion,
} from "./resolve-catalog-version.js";
import { parseReactMajor } from "./parse-react-major.js";
import { parseZodMajor } from "./parse-zod-major.js";
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
  let { reactVersion, tailwindVersion, zodVersion, framework } = extractDependencyInfo(packageJson);

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
  const zodDeclaration = getDependencyDeclaration({
    packageJson,
    packageName: "zod",
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

  if (!zodVersion && zodDeclaration.hasDeclaration) {
    zodVersion = resolveCatalogVersion(
      packageJson,
      "zod",
      directory,
      zodDeclaration.catalogReference,
    );
  }

  // HACK: keep the monorepo-root catalog read cheap (one package.json plus
  // pnpm-workspace catalogs). The expensive workspace walks below still key
  // off React/framework misses; if we walk anyway, they can fill Zod too.
  if (!reactVersion || !tailwindVersion || !zodVersion) {
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
        if (!zodVersion && zodDeclaration.hasDeclaration) {
          zodVersion = resolveCatalogVersion(
            rootPackageJson,
            "zod",
            monorepoRoot,
            zodDeclaration.catalogReference,
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
    if (!zodVersion && workspaceInfo.zodVersion) {
      zodVersion = workspaceInfo.zodVersion;
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
    if (!zodVersion) {
      zodVersion = monorepoInfo.zodVersion;
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
  if (!zodVersion && zodDeclaration.version && !isCatalogReference(zodDeclaration.version)) {
    zodVersion = zodDeclaration.version;
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

  // Expo implies React Native, so a project that isn't RN-aware anywhere
  // can never be Expo — skip the (root + workspace) `expo` version lookup
  // entirely in that case.
  let expoVersion = hasReactNativeWorkspace ? findExpoVersion(directory, packageJson) : null;

  // `findExpoVersion` returns the raw `expo` spec, which can be a `catalog:`
  // reference in pnpm-catalog monorepos. Resolve it the same way `react` /
  // `tailwind` / `zod` are resolved above, so the Expo SDK major can be
  // parsed — an unresolved `catalog:` spec would leave `expoVersion` non-null
  // (Expo checks still run) yet leave the SDK unresolvable, silently disabling
  // every SDK-gated Expo rule.
  if (expoVersion !== null && isCatalogReference(expoVersion)) {
    const catalogName = extractCatalogName(expoVersion);
    let resolvedExpoVersion = resolveCatalogVersion(packageJson, "expo", directory, catalogName);
    if (!resolvedExpoVersion) {
      const monorepoRoot = findMonorepoRoot(directory);
      if (monorepoRoot) {
        const monorepoPackageJsonPath = path.join(monorepoRoot, "package.json");
        if (isFile(monorepoPackageJsonPath)) {
          resolvedExpoVersion = resolveCatalogVersion(
            readPackageJson(monorepoPackageJsonPath),
            "expo",
            monorepoRoot,
            catalogName,
          );
        }
      }
    }
    expoVersion = resolvedExpoVersion ?? expoVersion;
  }

  // Only walk for reanimated once we already know it's an RN project —
  // reanimated implies React Native, so a web project can never declare
  // it, and this skips the workspace walk entirely for web monorepos.
  const hasReanimated =
    hasReactNativeWorkspace &&
    someWorkspacePackageJson(directory, packageJson, isPackageJsonReanimatedAware);

  const preactVersion = getPreactVersion(packageJson);

  const projectInfo: ProjectInfo = {
    rootDirectory: directory,
    projectName,
    reactVersion,
    reactMajorVersion: resolveEffectiveReactMajor(reactVersion, packageJson),
    tailwindVersion,
    zodVersion,
    zodMajorVersion: parseZodMajor(zodVersion),
    framework,
    hasTypeScript,
    hasReactCompiler: detectReactCompiler(directory, packageJson),
    hasTanStackQuery: hasTanStackQuery(packageJson),
    preactVersion,
    preactMajorVersion: parseReactMajor(preactVersion),
    hasReactNativeWorkspace,
    expoVersion,
    hasReanimated,
    sourceFileCount,
  };
  cachedProjectInfos.set(directory, projectInfo);
  return projectInfo;
};
