import * as fs from "node:fs";
import * as path from "node:path";
import { PackageJsonNotFoundError } from "./errors.js";
import type { PackageJson, ProjectInfo } from "../types/index.js";
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
  REACT_SECTIONS,
  resolveCatalogBackedDependencyVersion,
  resolveCatalogVersion,
  TAILWIND_ZOD_SECTIONS,
} from "./dependencies.js";
import { findMonorepoRoot, isMonorepoRoot } from "./monorepo-root.js";
import { findNearestAncestorPackageJson } from "./find-nearest-ancestor-package-json.js";
import {
  collectWorkspaceFacts,
  findDependencyInfoFromMonorepoRoot,
  SHOPIFY_FLASH_LIST_PACKAGE_NAME,
} from "./collect-project-facts.js";
import { resolveInstalledReactVersion } from "./resolve-installed-react-version.js";
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

  const enclosingProjectRoot = findNearestAncestorPackageJson(directory);
  const enclosingProject =
    enclosingProjectRoot !== null ? discoverProject(enclosingProjectRoot) : null;

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
    hasSsrDependency: false,
    preactVersion: null,
    preactMajorVersion: null,
    hasReactNativeWorkspace: false,
    nextjsVersion: null,
    nextjsMajorVersion: null,
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

  const packageJson = readPackageJson(packageJsonPath);
  const rootInfo = extractDependencyInfo(packageJson);
  let framework = rootInfo.framework;

  // One resolution ladder, written once for all three root-tracked
  // dependencies: root concrete spec → root catalogs → monorepo-root
  // catalogs → workspace walk (stage gate below) → enclosing-monorepo
  // fallback → raw declared spec.
  const tracked = {
    react: { version: rootInfo.reactVersion, sections: REACT_SECTIONS },
    tailwindcss: { version: rootInfo.tailwindVersion, sections: TAILWIND_ZOD_SECTIONS },
    zod: { version: rootInfo.zodVersion, sections: TAILWIND_ZOD_SECTIONS },
  };
  const declarations = Object.fromEntries(
    Object.entries(tracked).map(([packageName, entry]) => [
      packageName,
      getDependencyDeclaration({ packageJson, packageName, sections: entry.sections }),
    ]),
  );
  const fillFromCatalogs = (source: PackageJson, sourceDirectory: string): void => {
    for (const [packageName, entry] of Object.entries(tracked)) {
      if (!entry.version && declarations[packageName].hasDeclaration) {
        entry.version = resolveCatalogVersion(
          source,
          packageName,
          sourceDirectory,
          declarations[packageName].catalogReference,
        );
      }
    }
  };

  fillFromCatalogs(packageJson, directory);

  // HACK: keep the monorepo-root catalog read cheap (one package.json plus
  // pnpm-workspace catalogs). The expensive workspace walks below still key
  // off React/framework misses; if we walk anyway, they can fill Zod too.
  if (!tracked.react.version || !tracked.tailwindcss.version || !tracked.zod.version) {
    const monorepoRoot = findMonorepoRoot(directory);
    if (monorepoRoot) {
      const monorepoPackageJsonPath = path.join(monorepoRoot, "package.json");
      if (isFile(monorepoPackageJsonPath)) {
        fillFromCatalogs(readPackageJson(monorepoPackageJsonPath), monorepoRoot);
      }
    }
  }

  // The one workspace traversal: every workspace-derived fact (the react
  // group, RN/reanimated awareness, expo / flash-list / next specs) comes
  // out of this single pass; the gates below decide which apply.
  const shouldCollectReactGroup = !tracked.react.version || framework === "unknown";
  const workspaceFacts = collectWorkspaceFacts(directory, packageJson, {
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
    const monorepoInfo = findDependencyInfoFromMonorepoRoot(directory);
    tracked.react.version ||= monorepoInfo.reactVersion;
    tracked.tailwindcss.version ||= monorepoInfo.tailwindVersion;
    tracked.zod.version ||= monorepoInfo.zodVersion;
    if (framework === "unknown") {
      framework = monorepoInfo.framework;
    }
  }

  for (const [packageName, entry] of Object.entries(tracked)) {
    const declaredVersion = declarations[packageName].version;
    if (!entry.version && declaredVersion && !isCatalogReference(declaredVersion)) {
      entry.version = declaredVersion;
    }
  }
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
    hasSsrDependency: workspaceFacts.hasSsrDependency,
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
  return projectInfo;
};
