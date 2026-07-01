import * as fs from "node:fs";
import * as path from "node:path";
import { PackageJsonNotFoundError } from "./errors.js";
import type { ProjectInfo } from "../types/index.js";
import { isFile } from "./fs-utils.js";
import { countSourceFiles } from "./count-source-files.js";
import {
  detectNextjsStaticExport,
  detectPreES2023Target,
  detectReactCompiler,
} from "./detectors.js";
import {
  extractDependencyInfo,
  getDependencyDeclaration,
  getPreactVersion,
  hasTanStackQuery,
  isCatalogReference,
  resolveCatalogBackedDependencyVersion,
  resolveCatalogVersion,
} from "./dependencies.js";
import { findMonorepoRoot, isMonorepoRoot } from "./monorepo-root.js";
import {
  collectWorkspaceFacts,
  findDependencyInfoFromMonorepoRoot,
  SHOPIFY_FLASH_LIST_PACKAGE_NAME,
} from "./collect-project-facts.js";
import { readPackageJson } from "./package-json.js";
import {
  getLowestDependencyMajor,
  parseReactMajor,
  resolveEffectiveReactMajor,
} from "./version.js";

export { discoverReactSubprojects } from "./discover-react-subprojects.js";
export { formatFrameworkName } from "./detectors.js";
export { listWorkspacePackages } from "./workspaces.js";

const cachedProjectInfos = new Map<string, ProjectInfo>();

// HACK: paired with clearConfigCache — exposed so programmatic API
// consumers can re-detect after the project's package.json /
// tsconfig.json / monorepo manifests change between diagnose() calls.
export const clearProjectCache = (): void => {
  cachedProjectInfos.clear();
};

/**
 * Build a `ProjectInfo` for a directory that has no `package.json` of
 * its own — a monorepo subfolder like `repo/packages`, or any loose tree
 * of TypeScript/JavaScript files. Dependency + framework detection is
 * inherited from the enclosing workspace root when there is one, so
 * scanning a subdirectory of a React monorepo still gets the React
 * capabilities; a standalone non-React directory simply scans with the
 * framework-agnostic rules. Throws only when the directory has nothing
 * to scan (no enclosing project and no source files of its own).
 */
const discoverProjectWithoutPackageJson = (directory: string): ProjectInfo => {
  const sourceFileCount = countSourceFiles(directory);
  const hasOwnTsConfig = fs.existsSync(path.join(directory, "tsconfig.json"));

  const monorepoRoot = findMonorepoRoot(directory);
  const enclosingProject =
    monorepoRoot !== null && isFile(path.join(monorepoRoot, "package.json"))
      ? discoverProject(monorepoRoot)
      : null;

  // A workspace subfolder (e.g. `repo/packages`): keep the enclosing root's
  // dependency + framework detection, but scope the directory-specific fields
  // to this folder so React capabilities survive when a React monorepo
  // subdirectory is scanned.
  if (enclosingProject !== null) {
    return {
      ...enclosingProject,
      rootDirectory: directory,
      projectName: path.basename(directory),
      hasTypeScript: hasOwnTsConfig || enclosingProject.hasTypeScript,
      sourceFileCount,
    };
  }

  if (sourceFileCount === 0) {
    throw new PackageJsonNotFoundError(directory);
  }

  // A standalone tree of TypeScript/JavaScript files with no enclosing
  // project — analyzable with the framework-agnostic rules only.
  return {
    rootDirectory: directory,
    projectName: path.basename(directory),
    reactVersion: null,
    reactMajorVersion: null,
    tailwindVersion: null,
    zodVersion: null,
    zodMajorVersion: null,
    framework: "unknown",
    hasTypeScript: hasOwnTsConfig,
    hasReactCompiler: false,
    hasTanStackQuery: false,
    preactVersion: null,
    preactMajorVersion: null,
    hasReactNativeWorkspace: false,
    nextjsVersion: null,
    nextjsMajorVersion: null,
    expoVersion: null,
    shopifyFlashListVersion: null,
    shopifyFlashListMajorVersion: null,
    hasReanimated: false,
    isPreES2023Target: hasOwnTsConfig && detectPreES2023Target(directory),
    isStaticExport: false,
    sourceFileCount,
  };
};

export const discoverProject = (directory: string): ProjectInfo => {
  const cached = cachedProjectInfos.get(directory);
  if (cached !== undefined) return cached;

  const packageJsonPath = path.join(directory, "package.json");
  if (!isFile(packageJsonPath)) {
    const synthesized = discoverProjectWithoutPackageJson(directory);
    cachedProjectInfos.set(directory, synthesized);
    return synthesized;
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

  // The one workspace traversal: every workspace-derived fact (the react
  // group, RN/reanimated awareness, expo / flash-list / next specs) comes
  // out of this single pass; the gates below decide which apply.
  const shouldCollectReactGroup = !reactVersion || framework === "unknown";
  const workspaceFacts = collectWorkspaceFacts(directory, packageJson, {
    collectReactGroup: shouldCollectReactGroup,
  });

  if (shouldCollectReactGroup) {
    if (!reactVersion && workspaceFacts.reactVersion) {
      reactVersion = workspaceFacts.reactVersion;
    }
    if (!tailwindVersion && workspaceFacts.tailwindVersion) {
      tailwindVersion = workspaceFacts.tailwindVersion;
    }
    if (!zodVersion && workspaceFacts.zodVersion) {
      zodVersion = workspaceFacts.zodVersion;
    }
    if (framework === "unknown" && workspaceFacts.framework !== "unknown") {
      framework = workspaceFacts.framework;
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

  // The gates below are semantic, not perf: `expoVersion` / `nextjsVersion`
  // etc. must stay `null` unless the project actually classifies for them,
  // or capabilities like `expo` / `nextjs:15` would light up on projects
  // that merely have a stray dependency somewhere in the tree. The
  // capability gate in `buildCapabilities` keys off `hasReactNativeWorkspace`
  // so `rn-*` rules also load on web-rooted monorepos (a `next` root with an
  // `apps/mobile` Expo workspace, etc.).
  const hasReactNativeWorkspace =
    framework === "expo" ||
    framework === "react-native" ||
    workspaceFacts.hasReactNativeAwarePackage;

  const expoVersion = hasReactNativeWorkspace
    ? resolveCatalogBackedDependencyVersion({
        rootDirectory: directory,
        rootPackageJson: packageJson,
        packageName: "expo",
        version: workspaceFacts.expo.version,
      })
    : null;

  const shopifyFlashListVersion = hasReactNativeWorkspace
    ? resolveCatalogBackedDependencyVersion({
        rootDirectory: directory,
        rootPackageJson: packageJson,
        packageName: SHOPIFY_FLASH_LIST_PACKAGE_NAME,
        version: workspaceFacts.shopifyFlashList.version,
      })
    : null;

  // Reanimated implies React Native, so the fact only applies once the
  // project already classifies as RN.
  const hasReanimated = hasReactNativeWorkspace && workspaceFacts.hasReanimatedAwarePackage;

  const nextjsVersion =
    framework === "nextjs"
      ? resolveCatalogBackedDependencyVersion({
          rootDirectory: directory,
          rootPackageJson: packageJson,
          packageName: "next",
          version: workspaceFacts.next.version,
        })
      : null;
  const preactVersion = getPreactVersion(packageJson);
  const isPreES2023Target = hasTypeScript && detectPreES2023Target(directory);

  const projectInfo: ProjectInfo = {
    rootDirectory: directory,
    projectName,
    reactVersion,
    reactMajorVersion: resolveEffectiveReactMajor(reactVersion, packageJson),
    tailwindVersion,
    zodVersion,
    zodMajorVersion: zodVersion === null ? null : getLowestDependencyMajor(zodVersion),
    framework,
    hasTypeScript,
    hasReactCompiler: detectReactCompiler(directory, packageJson),
    hasTanStackQuery: hasTanStackQuery(packageJson),
    preactVersion,
    preactMajorVersion: parseReactMajor(preactVersion),
    hasReactNativeWorkspace,
    nextjsVersion,
    nextjsMajorVersion: nextjsVersion === null ? null : getLowestDependencyMajor(nextjsVersion),
    expoVersion,
    shopifyFlashListVersion,
    shopifyFlashListMajorVersion:
      shopifyFlashListVersion === null ? null : getLowestDependencyMajor(shopifyFlashListVersion),
    hasReanimated,
    isPreES2023Target,
    // The static-export probe reads `next.config.*` next to the manifest
    // that supplied the `next` dependency signal — the scan root when it
    // declares `next` itself, otherwise the first workspace (in walk order)
    // that does. With several Next workspaces, that first one decides,
    // matching how `nextjsVersion` is attributed. Falls back to the scan
    // root when the signal came from an enclosing monorepo instead (#976).
    isStaticExport:
      framework === "nextjs" &&
      detectNextjsStaticExport(workspaceFacts.next.sourceDirectory ?? directory),
    sourceFileCount,
  };
  cachedProjectInfos.set(directory, projectInfo);
  return projectInfo;
};
