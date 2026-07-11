import * as path from "node:path";
import type { DependencyInfo, Framework, PackageJson } from "../types/index.js";
import {
  EMPTY_DEPENDENCY_INFO,
  extractDependencyInfo,
  getDependencyDeclaration,
  getDependencySpec,
  REACT_SECTIONS,
  resolveCatalogVersion,
  TAILWIND_ZOD_SECTIONS,
} from "./dependencies.js";
import { isFile } from "./fs-utils.js";
import { findMonorepoRoot } from "./monorepo-root.js";
import { readPackageJson } from "./package-json.js";
import { frameworkMergeRank } from "./detectors.js";
import { isPackageJsonReactNativeAware, isPackageJsonReanimatedAware } from "./rn-metadata.js";
import { isPackageJsonSsrAware } from "./ssr-metadata.js";
import { getWorkspacePatterns, resolveWorkspaceDirectories } from "./workspaces.js";
import { parseReactMajor } from "./version.js";

const REANIMATED_DEPENDENCY_NAME = "react-native-reanimated";

// A dependency's declared spec plus the directory whose manifest supplied
// it — the scan root, or the workspace package that declares the package.
// `sourceDirectory` lets config-file detectors (e.g. the Next.js static-
// export probe) read the config next to the manifest that produced the
// framework signal instead of blindly probing the scan root.
interface DependencyFact {
  version: string | null;
  sourceDirectory: string | null;
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
  shopifyFlashList: DependencyFact;
  // Any-of predicates over the scan root + every workspace manifest.
  hasReactNativeAwarePackage: boolean;
  hasReanimatedAwarePackage: boolean;
  hasSsrDependency: boolean;
  reanimatedVersion: string | null;
}

export const SHOPIFY_FLASH_LIST_PACKAGE_NAME = "@shopify/flash-list";

interface ResolveWorkspaceDependencyVersionOptions {
  concreteVersion: string | null;
  packageName: string;
  rootDirectory: string;
  rootPackageJson: PackageJson;
  sections: ReadonlyArray<"dependencies" | "peerDependencies" | "devDependencies">;
  workspaceDirectory: string;
  workspacePackageJson: PackageJson;
}

const resolveWorkspaceDependencyVersion = ({
  concreteVersion,
  packageName,
  rootDirectory,
  rootPackageJson,
  sections,
  workspaceDirectory,
  workspacePackageJson,
}: ResolveWorkspaceDependencyVersionOptions): string | null => {
  const dependencyDeclaration = getDependencyDeclaration({
    packageJson: workspacePackageJson,
    packageName,
    sections,
  });
  if (!dependencyDeclaration.hasDeclaration) return null;

  return (
    concreteVersion ??
    resolveCatalogVersion(
      workspacePackageJson,
      packageName,
      workspaceDirectory,
      dependencyDeclaration.catalogReference,
    ) ??
    resolveCatalogVersion(
      rootPackageJson,
      packageName,
      rootDirectory,
      dependencyDeclaration.catalogReference,
    )
  );
};

// Lowest-major-wins: a monorepo mixing React 18 and 19 workspaces must be
// linted against the older runtime's constraints. Unparseable specs lose
// to parseable ones and never displace them.
const shouldReplaceReactVersion = (currentVersion: string | null, nextVersion: string): boolean => {
  if (!currentVersion) return true;

  const currentMajor = parseReactMajor(currentVersion);
  const nextMajor = parseReactMajor(nextVersion);

  if (currentMajor === null) return nextMajor !== null;
  if (nextMajor === null) return false;
  return nextMajor < currentMajor;
};

const evaluateManifestFacts = (
  facts: WorkspaceFacts,
  packageJson: PackageJson,
  directory: string,
): void => {
  if (facts.expo.version === null) {
    const spec = getDependencySpec(packageJson, "expo");
    if (spec !== null) facts.expo = { version: spec, sourceDirectory: directory };
  }
  if (facts.next.version === null) {
    const spec = getDependencySpec(packageJson, "next");
    if (spec !== null) facts.next = { version: spec, sourceDirectory: directory };
  }
  if (facts.shopifyFlashList.version === null) {
    const spec = getDependencySpec(packageJson, SHOPIFY_FLASH_LIST_PACKAGE_NAME);
    if (spec !== null) facts.shopifyFlashList = { version: spec, sourceDirectory: directory };
  }
  if (facts.reanimatedVersion === null) {
    const spec = getDependencySpec(packageJson, REANIMATED_DEPENDENCY_NAME);
    if (spec !== null) facts.reanimatedVersion = spec;
  }
  facts.hasReactNativeAwarePackage =
    facts.hasReactNativeAwarePackage || isPackageJsonReactNativeAware(packageJson);
  facts.hasReanimatedAwarePackage =
    facts.hasReanimatedAwarePackage || isPackageJsonReanimatedAware(packageJson);
  facts.hasSsrDependency = facts.hasSsrDependency || isPackageJsonSsrAware(packageJson);
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
  rootDirectory: string,
  rootPackageJson: PackageJson,
  { collectReactGroup }: CollectWorkspaceFactsOptions,
): WorkspaceFacts => {
  const facts: WorkspaceFacts = {
    reactVersion: null,
    tailwindVersion: null,
    zodVersion: null,
    framework: "unknown",
    expo: { version: null, sourceDirectory: null },
    next: { version: null, sourceDirectory: null },
    shopifyFlashList: { version: null, sourceDirectory: null },
    hasReactNativeAwarePackage: false,
    hasReanimatedAwarePackage: false,
    hasSsrDependency: false,
    reanimatedVersion: null,
  };

  evaluateManifestFacts(facts, rootPackageJson, rootDirectory);

  // Once react (major ≤ 17), tailwind, and the framework are all pinned,
  // later workspaces can't change the outcome the legacy walk would have
  // produced — it returned early here, so the group (zod included) stops
  // accumulating to preserve those exact results.
  let isReactGroupSettled = !collectReactGroup;

  const visitedDirectories = new Set<string>();
  for (const pattern of getWorkspacePatterns(rootDirectory, rootPackageJson)) {
    // Sorted so every fact resolves to the same workspace on repeated
    // analysis of the same tree — raw readdir order isn't stable.
    const directories = [...resolveWorkspaceDirectories(rootDirectory, pattern)].sort();
    for (const workspaceDirectory of directories) {
      if (visitedDirectories.has(workspaceDirectory)) continue;
      visitedDirectories.add(workspaceDirectory);
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));

      evaluateManifestFacts(facts, workspacePackageJson, workspaceDirectory);

      const info = extractDependencyInfo(workspacePackageJson);
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
        packageName: "react",
        rootDirectory,
        rootPackageJson,
        sections: REACT_SECTIONS,
        workspaceDirectory,
        workspacePackageJson,
      });
      const tailwindVersion = resolveWorkspaceDependencyVersion({
        concreteVersion: info.tailwindVersion,
        packageName: "tailwindcss",
        rootDirectory,
        rootPackageJson,
        sections: TAILWIND_ZOD_SECTIONS,
        workspaceDirectory,
        workspacePackageJson,
      });
      const zodVersion = resolveWorkspaceDependencyVersion({
        concreteVersion: info.zodVersion,
        packageName: "zod",
        rootDirectory,
        rootPackageJson,
        sections: TAILWIND_ZOD_SECTIONS,
        workspaceDirectory,
        workspacePackageJson,
      });

      if (reactVersion && shouldReplaceReactVersion(facts.reactVersion, reactVersion)) {
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
        sections: REACT_SECTIONS,
      })
    : null;
  const leafTailwindDeclaration = leafPackageJson
    ? getDependencyDeclaration({
        packageJson: leafPackageJson,
        packageName: "tailwindcss",
        sections: TAILWIND_ZOD_SECTIONS,
      })
    : null;
  const leafZodDeclaration = leafPackageJson
    ? getDependencyDeclaration({
        packageJson: leafPackageJson,
        packageName: "zod",
        sections: TAILWIND_ZOD_SECTIONS,
      })
    : null;
  const shouldUseReactFallback = !leafReactDeclaration?.hasDeclaration;
  const shouldUseTailwindFallback = leafTailwindDeclaration?.hasDeclaration ?? true;
  const shouldUseZodFallback = leafZodDeclaration?.hasDeclaration ?? true;
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
  const zodCatalogVersion = shouldUseZodFallback
    ? resolveCatalogVersion(
        rootPackageJson,
        "zod",
        monorepoRoot,
        leafZodDeclaration?.catalogReference,
      )
    : null;
  const workspaceFacts = collectWorkspaceFacts(monorepoRoot, rootPackageJson, {
    collectReactGroup: true,
  });

  return {
    reactVersion: shouldUseReactFallback
      ? (reactCatalogVersion ?? rootInfo.reactVersion ?? workspaceFacts.reactVersion)
      : (rootInfo.reactVersion ?? workspaceFacts.reactVersion),
    tailwindVersion: shouldUseTailwindFallback
      ? (tailwindCatalogVersion ?? rootInfo.tailwindVersion ?? workspaceFacts.tailwindVersion)
      : null,
    zodVersion: shouldUseZodFallback
      ? (zodCatalogVersion ?? rootInfo.zodVersion ?? workspaceFacts.zodVersion)
      : null,
    framework: rootInfo.framework !== "unknown" ? rootInfo.framework : workspaceFacts.framework,
  };
};
