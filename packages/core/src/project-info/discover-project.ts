import * as fs from "node:fs";
import * as path from "node:path";
import { PackageJsonNotFoundError } from "./errors.js";
import type { ProjectInfo } from "../types/index.js";
import { LATEST_SUPPORTED_MOBX_MAJOR } from "../constants.js";
import { isFile } from "./fs-utils.js";
import { countSourceFiles } from "./count-source-files.js";
import {
  detectNextjsStaticExport,
  detectReactCompiler,
  detectReactCompilerLintPlugin,
} from "./detectors.js";
import { detectPreES2023Target } from "./detect-pre-es2023-target.js";
import {
  getPreactVersion,
  REACT_SECTIONS,
  resolveCatalogBackedDependencyVersion,
  TAILWIND_ZOD_SECTIONS,
} from "./dependencies.js";
import { isMonorepoRoot } from "./monorepo-root.js";
import { findNearestAncestorPackageJson } from "./find-nearest-ancestor-package-json.js";
import {
  collectWorkspaceFacts,
  findDependencyInfoFromMonorepoRoot,
  SHOPIFY_FLASH_LIST_PACKAGE_NAME,
} from "./collect-project-facts.js";
import { resolveInstalledReactVersion } from "./resolve-installed-react-version.js";
import { readPackageJson } from "./package-json.js";
import { getTanStackQueryVersion } from "./get-tanstack-query-version.js";
import {
  buildPackageGraph,
  type PackageGraph,
  type PackageGraphDependencyDeclaration,
} from "./package-graph.js";
import {
  getDependencyMajorWithinSupportedRange,
  getLowestDependencyMajor,
  parseReactMajor,
  parseThreeRelease,
  resolveEffectiveReactMajor,
} from "./version.js";
import { clearTargetBlankOpenerProtectionCache } from "./detect-target-blank-opener-protection.js";

export { discoverReactSubprojects } from "./discover-react-subprojects.js";
export { formatFrameworkName } from "./detect-framework.js";
export { listWorkspacePackages } from "./workspaces.js";

const cachedProjectInfos = new Map<string, ProjectInfo>();
const cachedPackageGraphs = new Map<string, PackageGraph>();

const getCatalogResolvedVersion = (
  dependencyDeclaration: PackageGraphDependencyDeclaration | null,
): string | null => {
  if (
    dependencyDeclaration === null ||
    dependencyDeclaration.resolutionSource === "manifest" ||
    dependencyDeclaration.resolutionSource === "unresolved-catalog"
  ) {
    return null;
  }
  return dependencyDeclaration.resolvedSpecifier;
};

const getRawManifestVersion = (
  dependencyDeclaration: PackageGraphDependencyDeclaration | null,
): string | null =>
  dependencyDeclaration?.resolutionSource === "manifest"
    ? dependencyDeclaration.rawSpecifier
    : null;

// HACK: paired with clearConfigCache — exposed so programmatic API
// consumers can re-detect after the project's package.json /
// tsconfig.json / monorepo manifests change between diagnose() calls.
export const clearProjectCache = (): void => {
  cachedProjectInfos.clear();
  cachedPackageGraphs.clear();
  clearTargetBlankOpenerProtectionCache();
};

export const getDiscoveredPackageGraph = (directory: string): PackageGraph | null =>
  cachedPackageGraphs.get(directory) ?? null;

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

  const enclosingProjectRoot = findNearestAncestorPackageJson(directory);
  const enclosingProject =
    enclosingProjectRoot !== null ? discoverProject(enclosingProjectRoot) : null;

  // A workspace subfolder (e.g. `repo/packages`): keep the enclosing root's
  // dependency + framework detection, but scope the directory-specific fields
  // to this folder so React capabilities survive when a React monorepo
  // subdirectory is scanned.
  if (enclosingProject !== null) {
    const enclosingPackageGraph =
      enclosingProjectRoot === null ? undefined : cachedPackageGraphs.get(enclosingProjectRoot);
    if (enclosingPackageGraph !== undefined) {
      cachedPackageGraphs.set(directory, enclosingPackageGraph);
    }
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
    mobxVersion: null,
    mobxMajorVersion: null,
    hasMobxReact: false,
    mobxReactVersion: null,
    hasMobxReactLite: false,
    mobxReactLiteVersion: null,
    hasMobxStateTree: false,
    hasMobxReactObserver: false,
    zustandVersion: null,
    zustandMajorVersion: null,
    framework: "unknown",
    hasTypeScript: hasOwnTsConfig,
    hasReactCompiler: false,
    hasReactCompilerLintPlugin: false,
    hasTanStackQuery: false,
    valtioVersion: null,
    valtioMajorVersion: null,
    hasRemotion: false,
    remotionVersion: null,
    remotionMajorVersion: null,
    hasI18nLibrary: false,
    tanstackQueryVersion: null,
    styledComponentsVersion: null,
    hasThree: false,
    threeVersion: null,
    threeRelease: null,
    hasReactThreeFiber: false,
    reactThreeFiberVersion: null,
    reactThreeFiberMajorVersion: null,
    hasSsrDependency: false,
    preactVersion: null,
    preactMajorVersion: null,
    hasReactNativeWorkspace: false,
    nextjsVersion: null,
    nextjsMajorVersion: null,
    reactRouterVersion: null,
    hasReactRouterFramework: false,
    expoVersion: null,
    shopifyFlashListVersion: null,
    shopifyFlashListMajorVersion: null,
    hasReanimated: false,
    reanimatedVersion: null,
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

  const packageGraph = buildPackageGraph(directory, readPackageJson(packageJsonPath));
  const rootPackage = packageGraph.rootPackage;
  const packageJson = rootPackage.manifest;
  const rootInfo = rootPackage.dependencyInfo;
  let framework = rootInfo.framework;

  const declarations = {
    react: packageGraph.getDependency(directory, "react", REACT_SECTIONS),
    tailwindcss: packageGraph.getDependency(directory, "tailwindcss", TAILWIND_ZOD_SECTIONS),
    zod: packageGraph.getDependency(directory, "zod", TAILWIND_ZOD_SECTIONS),
  };
  const tracked = {
    react: {
      version: rootInfo.reactVersion ?? getCatalogResolvedVersion(declarations.react),
    },
    tailwindcss: {
      version: rootInfo.tailwindVersion ?? getCatalogResolvedVersion(declarations.tailwindcss),
    },
    zod: {
      version: rootInfo.zodVersion ?? getCatalogResolvedVersion(declarations.zod),
    },
  };

  const shouldCollectReactGroup = !tracked.react.version || framework === "unknown";
  const workspaceFacts = collectWorkspaceFacts(packageGraph, {
    collectReactGroup: shouldCollectReactGroup,
  });

  if (shouldCollectReactGroup) {
    tracked.react.version ||= workspaceFacts.reactVersion;
    tracked.tailwindcss.version ||= workspaceFacts.tailwindVersion;
    tracked.zod.version ||= workspaceFacts.zodVersion;
    if (framework === "unknown" && workspaceFacts.framework !== "unknown") {
      framework = workspaceFacts.framework;
    }
  }

  if ((!tracked.react.version || framework === "unknown") && !isMonorepoRoot(directory)) {
    const monorepoInfo = findDependencyInfoFromMonorepoRoot(directory, packageGraph);
    tracked.react.version ||= monorepoInfo.reactVersion;
    tracked.tailwindcss.version ||= monorepoInfo.tailwindVersion;
    tracked.zod.version ||= monorepoInfo.zodVersion;
    if (framework === "unknown") {
      framework = monorepoInfo.framework;
    }
  }

  tracked.react.version ||= getRawManifestVersion(declarations.react);
  tracked.tailwindcss.version ||= getRawManifestVersion(declarations.tailwindcss);
  tracked.zod.version ||= getRawManifestVersion(declarations.zod);
  const { react, tailwindcss, zod } = tracked;
  let reactVersion = react.version;
  if (!reactVersion || parseReactMajor(reactVersion) === null) {
    reactVersion = resolveInstalledReactVersion(directory) ?? reactVersion;
  }
  const tailwindVersion = tailwindcss.version;
  const zodVersion = zod.version;

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

  const zustandVersion = resolveCatalogBackedDependencyVersion({
    rootDirectory: directory,
    rootPackageJson: packageJson,
    packageName: "zustand",
    version: workspaceFacts.zustand.version,
  });

  // Reanimated implies React Native, so the fact only applies once the
  // project already classifies as RN.
  const hasReanimated = hasReactNativeWorkspace && workspaceFacts.hasReanimatedAwarePackage;
  const reanimatedVersion = hasReanimated ? workspaceFacts.reanimatedVersion : null;

  const nextjsVersion =
    framework === "nextjs"
      ? resolveCatalogBackedDependencyVersion({
          rootDirectory: directory,
          rootPackageJson: packageJson,
          packageName: "next",
          version: workspaceFacts.next.version,
        })
      : null;
  const valtioVersion = resolveCatalogBackedDependencyVersion({
    rootDirectory: directory,
    rootPackageJson: packageJson,
    packageName: "valtio",
    version: workspaceFacts.valtioVersion,
  });
  const mobxVersion = resolveCatalogBackedDependencyVersion({
    rootDirectory: directory,
    rootPackageJson: packageJson,
    packageName: "mobx",
    version: workspaceFacts.mobx.version,
  });
  const reactRouterVersion =
    workspaceFacts.reactRouter.packageName === null
      ? null
      : resolveCatalogBackedDependencyVersion({
          rootDirectory: directory,
          rootPackageJson: packageJson,
          packageName: workspaceFacts.reactRouter.packageName,
          version: workspaceFacts.reactRouter.version,
        });
  const preactVersion = getPreactVersion(packageJson);
  const remotionVersion = workspaceFacts.remotionVersion;
  const tanstackQueryVersion =
    getTanStackQueryVersion(packageJson) ?? workspaceFacts.tanstackQueryVersion;
  const reactThreeFiberVersion = workspaceFacts.reactThreeFiber.packageName
    ? resolveCatalogBackedDependencyVersion({
        rootDirectory: directory,
        rootPackageJson: packageJson,
        packageName: workspaceFacts.reactThreeFiber.packageName,
        version: workspaceFacts.reactThreeFiber.version,
      })
    : null;
  const threeVersion = resolveCatalogBackedDependencyVersion({
    rootDirectory: directory,
    rootPackageJson: packageJson,
    packageName: "three",
    version: workspaceFacts.threeVersion,
  });
  const isPreES2023Target = hasTypeScript && detectPreES2023Target(directory);

  const projectInfo: ProjectInfo = {
    rootDirectory: directory,
    projectName,
    reactVersion,
    reactMajorVersion: resolveEffectiveReactMajor(reactVersion, packageJson),
    tailwindVersion,
    zodVersion,
    zodMajorVersion: zodVersion === null ? null : getLowestDependencyMajor(zodVersion),
    mobxVersion,
    mobxMajorVersion:
      mobxVersion === null
        ? null
        : getDependencyMajorWithinSupportedRange(mobxVersion, LATEST_SUPPORTED_MOBX_MAJOR),
    hasMobxReact: workspaceFacts.hasMobxReact,
    mobxReactVersion: workspaceFacts.mobxReactVersion,
    hasMobxReactLite: workspaceFacts.hasMobxReactLite,
    mobxReactLiteVersion: workspaceFacts.mobxReactLiteVersion,
    hasMobxStateTree: workspaceFacts.hasMobxStateTree,
    hasMobxReactObserver: workspaceFacts.hasMobxReactObserver,
    zustandVersion,
    zustandMajorVersion: zustandVersion === null ? null : getLowestDependencyMajor(zustandVersion),
    framework,
    hasTypeScript,
    hasReactCompiler: detectReactCompiler(directory, packageJson),
    hasReactCompilerLintPlugin: detectReactCompilerLintPlugin(directory, packageJson),
    hasTanStackQuery: tanstackQueryVersion !== null,
    hasI18nLibrary: workspaceFacts.hasI18nLibrary,
    tanstackQueryVersion,
    styledComponentsVersion: workspaceFacts.styledComponentsVersion,
    valtioVersion,
    valtioMajorVersion: valtioVersion === null ? null : getLowestDependencyMajor(valtioVersion),
    hasRemotion: workspaceFacts.hasRemotionDependency,
    remotionVersion,
    remotionMajorVersion:
      remotionVersion === null ? null : getLowestDependencyMajor(remotionVersion),
    hasThree: workspaceFacts.hasThree,
    threeVersion,
    threeRelease: parseThreeRelease(threeVersion),
    hasReactThreeFiber: workspaceFacts.hasReactThreeFiber,
    reactThreeFiberVersion,
    reactThreeFiberMajorVersion:
      reactThreeFiberVersion === null ? null : getLowestDependencyMajor(reactThreeFiberVersion),
    hasSsrDependency: workspaceFacts.hasSsrDependency,
    preactVersion,
    preactMajorVersion: parseReactMajor(preactVersion),
    hasReactNativeWorkspace,
    nextjsVersion,
    nextjsMajorVersion: nextjsVersion === null ? null : getLowestDependencyMajor(nextjsVersion),
    reactRouterVersion,
    hasReactRouterFramework: workspaceFacts.hasReactRouterFramework,
    expoVersion,
    shopifyFlashListVersion,
    shopifyFlashListMajorVersion:
      shopifyFlashListVersion === null ? null : getLowestDependencyMajor(shopifyFlashListVersion),
    hasReanimated,
    reanimatedVersion,
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
  cachedPackageGraphs.set(directory, packageGraph);
  return projectInfo;
};
