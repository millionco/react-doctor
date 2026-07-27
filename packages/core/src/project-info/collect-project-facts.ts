import * as path from "node:path";
import type { DependencyInfo, Framework, PackageJson } from "../types/index.js";
import {
  EARLIEST_GATED_STYLED_COMPONENTS_MAJOR,
  LATEST_SUPPORTED_MOBX_MAJOR,
  LATEST_SUPPORTED_ZUSTAND_MAJOR,
} from "../constants.js";
import {
  EMPTY_DEPENDENCY_INFO,
  getDependencyDeclaration,
  getDependencySpec,
  isCatalogReference,
  REACT_SECTIONS,
  resolveCatalogBackedDependencyVersion,
  resolveCatalogVersion,
  TAILWIND_ZOD_SECTIONS,
} from "./dependencies.js";
import {
  MOBX_REACT_LITE_PACKAGE_NAME,
  MOBX_REACT_OBSERVER_PACKAGE_NAME,
  MOBX_REACT_PACKAGE_NAME,
  MOBX_STATE_TREE_PACKAGE_NAME,
  REACT_ROUTER_DEPENDENCY_NAMES,
  REACT_THREE_FIBER_DEPENDENCY_NAMES,
  REACT_THREE_FIBER_ECOSYSTEM_DEPENDENCY_NAMES,
  REANIMATED_DEPENDENCY_NAME,
  THREE_DEPENDENCY_NAMES,
} from "./capability-dependency-names.js";
import { isFile } from "./fs-utils.js";
import { findMonorepoRoot } from "./monorepo-root.js";
import { readPackageJson } from "./package-json.js";
import { frameworkMergeRank } from "./detect-framework.js";
import { isPackageJsonReactNativeAware, isPackageJsonReanimatedAware } from "./rn-metadata.js";
import { isPackageJsonSsrAware } from "./ssr-metadata.js";
import { buildPackageGraph, type PackageGraph } from "./package-graph.js";
import {
  getDependencyMajorWithinSupportedRange,
  getLowestDependencyMajor,
  parseDependencyMajorMinor,
  parseReactMajor,
  parseReactMajorMinor,
  parseThreeRelease,
} from "./version.js";
import { getTanStackQueryVersion } from "./get-tanstack-query-version.js";
import { getStyledComponentsVersion } from "./get-styled-components-version.js";
import { hasI18nDependency } from "./has-i18n-dependency.js";

const REACT_THREE_FIBER_SECTIONS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
] as const;
const THREE_DEPENDENCY_SECTIONS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
] as const;
// A dependency's declared spec plus the directory whose manifest supplied
// it — the scan root, or the workspace package that declares the package.
// `sourceDirectory` lets config-file detectors (e.g. the Next.js static-
// export probe) read the config next to the manifest that produced the
// framework signal instead of blindly probing the scan root.
interface DependencyFact {
  version: string | null;
  sourceDirectory: string | null;
}

interface ReactThreeFiberDependencyFact extends DependencyFact {
  packageName: string | null;
}

interface ReactRouterDependencyFact extends DependencyFact {
  packageName: string | null;
}

export interface WorkspaceFacts {
  // The stage-D group: react merges lowest-major-wins, tailwind/zod/
  // framework are first-hit. Collected from WORKSPACE manifests only —
  // the scan root's own manifest is handled by the earlier catalog stages
  // in `discoverProject`, which also decides whether this group applies
  // at all (it fills only when the root left react/framework unresolved).
  reactVersion: string | null;
  tailwindVersion: string | null;
  zodVersion: string | null;
  framework: Framework;
  // First manifest (scan root first, then walk order) declaring the
  // package, in any of the four dependency sections.
  expo: DependencyFact;
  next: DependencyFact;
  reactRouter: ReactRouterDependencyFact;
  shopifyFlashList: DependencyFact;
  valtioVersion: string | null;
  mobx: DependencyFact;
  hasMobxReact: boolean;
  mobxReactVersion: string | null;
  hasMobxReactLite: boolean;
  mobxReactLiteVersion: string | null;
  hasMobxStateTree: boolean;
  hasMobxReactObserver: boolean;
  // Conservative representative across every declaring manifest: an
  // unparseable or future major wins; otherwise the lowest major wins.
  zustand: DependencyFact;
  tanstackQueryVersion: string | null;
  styledComponentsVersion: string | null;
  // Any-of predicates over the scan root + every workspace manifest.
  hasI18nLibrary: boolean;
  hasReactNativeAwarePackage: boolean;
  hasReanimatedAwarePackage: boolean;
  hasSsrDependency: boolean;
  hasRemotionDependency: boolean;
  hasUnknownRemotionVersion: boolean;
  remotionVersion: string | null;
  hasThree: boolean;
  threeVersion: string | null;
  hasReactThreeFiber: boolean;
  reactThreeFiber: ReactThreeFiberDependencyFact;
  hasReactRouterFramework: boolean;
  reanimatedVersion: string | null;
}

export const SHOPIFY_FLASH_LIST_PACKAGE_NAME = "@shopify/flash-list";

interface ResolveWorkspaceDependencyVersionOptions {
  concreteVersion: string | null;
  packageGraph: PackageGraph;
  packageName: string;
  sections: ReadonlyArray<"dependencies" | "peerDependencies" | "devDependencies">;
  workspaceDirectory: string;
}

const resolveWorkspaceDependencyVersion = ({
  concreteVersion,
  packageGraph,
  packageName,
  sections,
  workspaceDirectory,
}: ResolveWorkspaceDependencyVersionOptions): string | null => {
  if (concreteVersion !== null) return concreteVersion;
  const dependencyDeclaration = packageGraph.getDependency(
    workspaceDirectory,
    packageName,
    sections,
  );
  if (
    dependencyDeclaration === null ||
    !isCatalogReference(dependencyDeclaration.rawSpecifier) ||
    (dependencyDeclaration.resolutionSource !== "declaring-package-catalog" &&
      dependencyDeclaration.resolutionSource !== "workspace-root-catalog")
  ) {
    return null;
  }
  return dependencyDeclaration.resolvedSpecifier;
};

// Lowest-major-wins: mixed-version monorepos must be linted against the
// older runtime's constraints. Unparseable specs lose to parseable ones
// and never displace them.
const shouldReplaceWithLowerMajor = (
  currentVersion: string | null,
  nextVersion: string,
): boolean => {
  if (!currentVersion) return true;

  const currentMajor = parseReactMajor(currentVersion);
  const nextMajor = parseReactMajor(nextVersion);

  if (currentMajor === null) return nextMajor !== null;
  if (nextMajor === null) return false;
  return nextMajor < currentMajor;
};

const shouldReplaceSupportedDependencyFact = (
  currentFact: DependencyFact,
  nextFact: DependencyFact,
  latestSupportedMajor: number,
): boolean => {
  if (currentFact.version === null) return true;
  if (nextFact.version === null) return false;

  const currentMajor = getLowestDependencyMajor(currentFact.version);
  const nextMajor = getLowestDependencyMajor(nextFact.version);
  if (currentMajor === null) return false;
  if (nextMajor === null) return true;
  if (currentMajor > latestSupportedMajor) return false;
  if (nextMajor > latestSupportedMajor) return true;
  return nextMajor < currentMajor;
};

const shouldReplaceStyledComponentsVersion = (
  currentVersion: string | null,
  nextVersion: string,
): boolean => {
  if (!currentVersion) return true;

  const currentMajor = getLowestDependencyMajor(currentVersion);
  const nextMajor = getLowestDependencyMajor(nextVersion);

  if (currentMajor === null) {
    return nextMajor !== null && nextMajor < EARLIEST_GATED_STYLED_COMPONENTS_MAJOR;
  }
  if (nextMajor === null) return currentMajor >= EARLIEST_GATED_STYLED_COMPONENTS_MAJOR;
  return nextMajor < currentMajor;
};

const selectOldestDependencyVersion = (
  currentVersion: string | null,
  nextVersion: string | null,
): string | null => {
  if (currentVersion === null || nextVersion === null) return null;
  const current = parseDependencyMajorMinor(currentVersion);
  const next = parseDependencyMajorMinor(nextVersion);
  if (current === null) return currentVersion;
  if (next === null) return nextVersion;
  if (next.major !== current.major)
    return next.major < current.major ? nextVersion : currentVersion;
  return next.minor < current.minor ? nextVersion : currentVersion;
};

const shouldReplaceMobxFact = (currentFact: DependencyFact, nextFact: DependencyFact): boolean => {
  if (currentFact.sourceDirectory === null) return true;
  if (currentFact.version === null) return false;
  if (nextFact.version === null) return true;

  const currentMajor = getDependencyMajorWithinSupportedRange(
    currentFact.version,
    LATEST_SUPPORTED_MOBX_MAJOR,
  );
  const nextMajor = getDependencyMajorWithinSupportedRange(
    nextFact.version,
    LATEST_SUPPORTED_MOBX_MAJOR,
  );
  if (currentMajor === null) return false;
  if (nextMajor === null) return true;
  return selectOldestDependencyVersion(currentFact.version, nextFact.version) === nextFact.version;
};

const collectBindingVersion = (
  facts: WorkspaceFacts,
  packageJson: PackageJson,
  directory: string,
  packageName: typeof MOBX_REACT_PACKAGE_NAME | typeof MOBX_REACT_LITE_PACKAGE_NAME,
): void => {
  const version = getDependencySpec(packageJson, packageName);
  if (version === null) return;
  const resolvedVersion = resolveCatalogBackedDependencyVersion({
    rootDirectory: directory,
    rootPackageJson: packageJson,
    packageName,
    version,
  });
  if (packageName === MOBX_REACT_PACKAGE_NAME) {
    facts.mobxReactVersion = facts.hasMobxReact
      ? selectOldestDependencyVersion(facts.mobxReactVersion, resolvedVersion)
      : resolvedVersion;
    facts.hasMobxReact = true;
    return;
  }
  facts.mobxReactLiteVersion = facts.hasMobxReactLite
    ? selectOldestDependencyVersion(facts.mobxReactLiteVersion, resolvedVersion)
    : resolvedVersion;
  facts.hasMobxReactLite = true;
};

const shouldReplaceReactRouterVersion = (
  currentVersion: string | null,
  nextVersion: string,
): boolean => {
  if (currentVersion === null) return true;
  const current = parseReactMajorMinor(currentVersion);
  const next = parseReactMajorMinor(nextVersion);
  if (current === null) return next !== null;
  if (next === null) return false;
  if (next.major !== current.major) return next.major < current.major;
  return next.minor < current.minor;
};

const evaluateManifestFacts = (
  facts: WorkspaceFacts,
  packageJson: PackageJson,
  directory: string,
  rootDirectory: string,
  rootPackageJson: PackageJson,
): void => {
  if (facts.expo.version === null) {
    const spec = getDependencySpec(packageJson, "expo");
    if (spec !== null) facts.expo = { version: spec, sourceDirectory: directory };
  }
  if (facts.next.version === null) {
    const spec = getDependencySpec(packageJson, "next");
    if (spec !== null) facts.next = { version: spec, sourceDirectory: directory };
  }
  for (const packageName of REACT_ROUTER_DEPENDENCY_NAMES) {
    const spec = getDependencySpec(packageJson, packageName);
    const resolvedSpec = resolveCatalogBackedDependencyVersion({
      rootDirectory,
      rootPackageJson,
      sourceDirectory: directory,
      sourcePackageJson: packageJson,
      packageName,
      version: spec,
    });
    if (
      resolvedSpec === null ||
      !shouldReplaceReactRouterVersion(facts.reactRouter.version, resolvedSpec)
    )
      continue;
    facts.reactRouter = { version: resolvedSpec, sourceDirectory: directory, packageName };
  }
  facts.hasReactRouterFramework =
    facts.hasReactRouterFramework || getDependencySpec(packageJson, "@react-router/dev") !== null;
  if (facts.shopifyFlashList.version === null) {
    const spec = getDependencySpec(packageJson, SHOPIFY_FLASH_LIST_PACKAGE_NAME);
    if (spec !== null) facts.shopifyFlashList = { version: spec, sourceDirectory: directory };
  }
  const mobxSpec = getDependencySpec(packageJson, "mobx");
  if (mobxSpec !== null) {
    const nextMobxFact = {
      version: resolveCatalogBackedDependencyVersion({
        rootDirectory: directory,
        rootPackageJson: packageJson,
        packageName: "mobx",
        version: mobxSpec,
      }),
      sourceDirectory: directory,
    };
    if (shouldReplaceMobxFact(facts.mobx, nextMobxFact)) {
      facts.mobx = nextMobxFact;
    }
  }
  collectBindingVersion(facts, packageJson, directory, MOBX_REACT_PACKAGE_NAME);
  collectBindingVersion(facts, packageJson, directory, MOBX_REACT_LITE_PACKAGE_NAME);
  facts.hasMobxStateTree =
    facts.hasMobxStateTree || getDependencySpec(packageJson, MOBX_STATE_TREE_PACKAGE_NAME) !== null;
  facts.hasMobxReactObserver =
    facts.hasMobxReactObserver ||
    getDependencySpec(packageJson, MOBX_REACT_OBSERVER_PACKAGE_NAME) !== null;
  const zustandSpec = getDependencySpec(packageJson, "zustand");
  if (zustandSpec !== null) {
    const nextZustandFact = {
      version: resolveCatalogBackedDependencyVersion({
        rootDirectory: directory,
        rootPackageJson: packageJson,
        packageName: "zustand",
        version: zustandSpec,
      }),
      sourceDirectory: directory,
    };
    if (
      shouldReplaceSupportedDependencyFact(
        facts.zustand,
        nextZustandFact,
        LATEST_SUPPORTED_ZUSTAND_MAJOR,
      )
    ) {
      facts.zustand = nextZustandFact;
    }
  }
  if (facts.reanimatedVersion === null) {
    const spec = getDependencySpec(packageJson, REANIMATED_DEPENDENCY_NAME);
    if (spec !== null) facts.reanimatedVersion = spec;
  }
  if (facts.valtioVersion === null) {
    const spec = getDependencySpec(packageJson, "valtio");
    if (spec !== null) facts.valtioVersion = spec;
  }
  facts.tanstackQueryVersion ??= getTanStackQueryVersion(packageJson);
  const styledComponentsVersion = resolveCatalogBackedDependencyVersion({
    rootDirectory: directory,
    rootPackageJson: packageJson,
    packageName: "styled-components",
    version: getStyledComponentsVersion(packageJson),
  });
  if (
    styledComponentsVersion &&
    shouldReplaceStyledComponentsVersion(facts.styledComponentsVersion, styledComponentsVersion)
  ) {
    facts.styledComponentsVersion = styledComponentsVersion;
  }
  facts.hasI18nLibrary = facts.hasI18nLibrary || hasI18nDependency(packageJson);
  for (const packageName of REACT_THREE_FIBER_DEPENDENCY_NAMES) {
    const dependencyDeclaration = getDependencyDeclaration({
      packageName,
      packageJson,
      sections: REACT_THREE_FIBER_SECTIONS,
    });
    const version = resolveCatalogBackedDependencyVersion({
      rootDirectory,
      rootPackageJson,
      sourceDirectory: directory,
      sourcePackageJson: packageJson,
      packageName,
      version: dependencyDeclaration.version,
    });
    if (version === null) continue;
    if (shouldReplaceWithLowerMajor(facts.reactThreeFiber.version, version)) {
      facts.reactThreeFiber = { packageName, version, sourceDirectory: directory };
    }
  }
  const threeDependencyDeclaration = getDependencyDeclaration({
    packageName: "three",
    packageJson,
    sections: THREE_DEPENDENCY_SECTIONS,
  });
  const threeVersion = resolveCatalogBackedDependencyVersion({
    rootDirectory,
    rootPackageJson,
    sourceDirectory: directory,
    sourcePackageJson: packageJson,
    packageName: "three",
    version: threeDependencyDeclaration.version,
  });
  if (threeVersion !== null) {
    const currentRelease = parseThreeRelease(facts.threeVersion);
    const nextRelease = parseThreeRelease(threeVersion);
    if (
      facts.threeVersion === null ||
      (nextRelease !== null && (currentRelease === null || nextRelease < currentRelease))
    ) {
      facts.threeVersion = threeVersion;
    }
  }
  facts.hasReactNativeAwarePackage =
    facts.hasReactNativeAwarePackage || isPackageJsonReactNativeAware(packageJson);
  facts.hasReanimatedAwarePackage =
    facts.hasReanimatedAwarePackage || isPackageJsonReanimatedAware(packageJson);
  facts.hasSsrDependency = facts.hasSsrDependency || isPackageJsonSsrAware(packageJson);
  const remotionSpec = getDependencySpec(packageJson, "remotion");
  if (remotionSpec !== null) {
    facts.hasRemotionDependency = true;
    const resolvedRemotionVersion = resolveCatalogBackedDependencyVersion({
      rootDirectory,
      rootPackageJson,
      packageName: "remotion",
      version: remotionSpec,
    });
    const remotionMajorVersion =
      resolvedRemotionVersion === null ? null : getLowestDependencyMajor(resolvedRemotionVersion);
    if (remotionMajorVersion === null) {
      facts.hasUnknownRemotionVersion = true;
      facts.remotionVersion = null;
    } else if (!facts.hasUnknownRemotionVersion) {
      const currentRemotionMajorVersion =
        facts.remotionVersion === null ? null : getLowestDependencyMajor(facts.remotionVersion);
      if (
        currentRemotionMajorVersion === null ||
        remotionMajorVersion < currentRemotionMajorVersion
      ) {
        facts.remotionVersion = resolvedRemotionVersion;
      }
    }
  }
  facts.hasThree =
    facts.hasThree ||
    THREE_DEPENDENCY_NAMES.some(
      (dependencyName) => getDependencySpec(packageJson, dependencyName) !== null,
    );
  facts.hasReactThreeFiber =
    facts.hasReactThreeFiber ||
    REACT_THREE_FIBER_ECOSYSTEM_DEPENDENCY_NAMES.some(
      (dependencyName) => getDependencySpec(packageJson, dependencyName) !== null,
    );
};

interface CollectWorkspaceFactsOptions {
  // The stage-D group costs catalog resolution per declaring workspace, so
  // callers whose root manifest already resolved react + framework skip it
  // (its results would be discarded by the stage-D gate anyway).
  collectReactGroup: boolean;
}

// The one workspace traversal behind `discoverProject`: enumerates the
// workspace directories once (pattern order, sorted within each pattern,
// deduped across overlapping globs) and evaluates every workspace-derived
// fact per manifest. Replaces the previous per-fact walks (react/tailwind/
// zod/framework, React Native awareness, reanimated, expo, flash-list,
// next) that each re-resolved the same globs and re-visited the same
// manifests.
export const collectWorkspaceFacts = (
  packageGraph: PackageGraph,
  { collectReactGroup }: CollectWorkspaceFactsOptions,
): WorkspaceFacts => {
  const rootPackage = packageGraph.rootPackage;
  const rootPackageJson = rootPackage.manifest;
  const facts: WorkspaceFacts = {
    reactVersion: null,
    tailwindVersion: null,
    zodVersion: null,
    framework: "unknown",
    expo: { version: null, sourceDirectory: null },
    next: { version: null, sourceDirectory: null },
    reactRouter: { version: null, sourceDirectory: null, packageName: null },
    shopifyFlashList: { version: null, sourceDirectory: null },
    valtioVersion: null,
    mobx: { version: null, sourceDirectory: null },
    hasMobxReact: false,
    mobxReactVersion: null,
    hasMobxReactLite: false,
    mobxReactLiteVersion: null,
    hasMobxStateTree: false,
    hasMobxReactObserver: false,
    zustand: { version: null, sourceDirectory: null },
    tanstackQueryVersion: null,
    styledComponentsVersion: null,
    hasI18nLibrary: false,
    hasReactNativeAwarePackage: false,
    hasReanimatedAwarePackage: false,
    hasSsrDependency: false,
    hasRemotionDependency: false,
    hasUnknownRemotionVersion: false,
    remotionVersion: null,
    hasThree: false,
    threeVersion: null,
    hasReactThreeFiber: false,
    reactThreeFiber: { packageName: null, version: null, sourceDirectory: null },
    hasReactRouterFramework: false,
    reanimatedVersion: null,
  };

  evaluateManifestFacts(
    facts,
    rootPackage.manifest,
    rootPackage.directory,
    packageGraph.rootDirectory,
    rootPackageJson,
  );

  // Once react (major ≤ 17), tailwind, and the framework are all pinned,
  // later workspaces can't change the outcome the legacy walk would have
  // produced — it returned early here, so the group (zod included) stops
  // accumulating to preserve those exact results.
  let isReactGroupSettled = !collectReactGroup;

  for (const workspacePackage of packageGraph.packages.slice(1)) {
    const workspaceDirectory = workspacePackage.directory;
    const workspacePackageJson = workspacePackage.manifest;

    evaluateManifestFacts(
      facts,
      workspacePackageJson,
      workspaceDirectory,
      packageGraph.rootDirectory,
      rootPackageJson,
    );

    const info = workspacePackage.dependencyInfo;
    // Priority merge, not first-hit: a web framework outranks a mobile one
    // across workspaces (see `frameworkMergeRank`), with walk order only
    // breaking ties between equal ranks.
    if (
      info.framework !== "unknown" &&
      frameworkMergeRank(info.framework) < frameworkMergeRank(facts.framework)
    ) {
      facts.framework = info.framework;
    }

    if (isReactGroupSettled) continue;
    const reactVersion = resolveWorkspaceDependencyVersion({
      concreteVersion: info.reactVersion,
      packageGraph,
      packageName: "react",
      sections: REACT_SECTIONS,
      workspaceDirectory,
    });
    const tailwindVersion = resolveWorkspaceDependencyVersion({
      concreteVersion: info.tailwindVersion,
      packageGraph,
      packageName: "tailwindcss",
      sections: TAILWIND_ZOD_SECTIONS,
      workspaceDirectory,
    });
    const zodVersion = resolveWorkspaceDependencyVersion({
      concreteVersion: info.zodVersion,
      packageGraph,
      packageName: "zod",
      sections: TAILWIND_ZOD_SECTIONS,
      workspaceDirectory,
    });

    if (reactVersion && shouldReplaceWithLowerMajor(facts.reactVersion, reactVersion)) {
      facts.reactVersion = reactVersion;
    }
    if (tailwindVersion && !facts.tailwindVersion) {
      facts.tailwindVersion = tailwindVersion;
    }
    if (zodVersion && !facts.zodVersion) {
      facts.zodVersion = zodVersion;
    }

    const settledReactMajor = parseReactMajor(facts.reactVersion);
    isReactGroupSettled = Boolean(
      facts.reactVersion &&
      facts.tailwindVersion &&
      facts.framework !== "unknown" &&
      settledReactMajor !== null &&
      settledReactMajor <= 17,
    );
  }

  return facts;
};

// Dependency facts inherited from the ENCLOSING monorepo when a leaf scan
// leaves react/framework unresolved: monorepo-root catalogs (keyed by the
// leaf's own catalog reference), the root manifest's concrete specs, then
// the monorepo's workspaces. React falls back only when the leaf does NOT
// declare it (a declared-but-unresolvable spec must not be masked by the
// root's version); tailwind/zod fall back only when the leaf DOES declare
// them (or has no manifest at all) — otherwise a sibling workspace's
// styling stack would leak into an unrelated leaf.
export const findDependencyInfoFromMonorepoRoot = (
  directory: string,
  sourcePackageGraph: PackageGraph,
): DependencyInfo => {
  const monorepoRoot = findMonorepoRoot(directory);
  if (!monorepoRoot) return EMPTY_DEPENDENCY_INFO;

  const monorepoPackageJsonPath = path.join(monorepoRoot, "package.json");
  if (!isFile(monorepoPackageJsonPath)) return EMPTY_DEPENDENCY_INFO;

  const rootPackageJson = readPackageJson(monorepoPackageJsonPath);
  const packageGraph = buildPackageGraph(monorepoRoot, rootPackageJson);
  const rootInfo = packageGraph.rootPackage.dependencyInfo;
  const leafReactDeclaration = sourcePackageGraph.getDependency(directory, "react", REACT_SECTIONS);
  const leafTailwindDeclaration = sourcePackageGraph.getDependency(
    directory,
    "tailwindcss",
    TAILWIND_ZOD_SECTIONS,
  );
  const leafZodDeclaration = sourcePackageGraph.getDependency(
    directory,
    "zod",
    TAILWIND_ZOD_SECTIONS,
  );
  const shouldUseReactFallback = leafReactDeclaration === null;
  const shouldUseTailwindFallback = leafTailwindDeclaration !== null;
  const shouldUseZodFallback = leafZodDeclaration !== null;
  const reactCatalogVersion = shouldUseReactFallback
    ? resolveCatalogVersion(rootPackageJson, "react", monorepoRoot, null)
    : null;
  const tailwindCatalogVersion = shouldUseTailwindFallback
    ? resolveCatalogVersion(
        rootPackageJson,
        "tailwindcss",
        monorepoRoot,
        leafTailwindDeclaration.catalogReference,
      )
    : null;
  const zodCatalogVersion = shouldUseZodFallback
    ? resolveCatalogVersion(
        rootPackageJson,
        "zod",
        monorepoRoot,
        leafZodDeclaration.catalogReference,
      )
    : null;
  const workspaceFacts = collectWorkspaceFacts(packageGraph, {
    collectReactGroup: true,
  });

  return {
    reactVersion: shouldUseReactFallback
      ? (reactCatalogVersion ?? rootInfo.reactVersion ?? workspaceFacts.reactVersion)
      : null,
    tailwindVersion: shouldUseTailwindFallback
      ? (tailwindCatalogVersion ?? rootInfo.tailwindVersion ?? workspaceFacts.tailwindVersion)
      : null,
    zodVersion: shouldUseZodFallback
      ? (zodCatalogVersion ?? rootInfo.zodVersion ?? workspaceFacts.zodVersion)
      : null,
    framework: rootInfo.framework !== "unknown" ? rootInfo.framework : workspaceFacts.framework,
  };
};
