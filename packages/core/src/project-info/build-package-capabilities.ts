import * as path from "node:path";
import type { Capability } from "oxlint-plugin-react-doctor/contracts";
import { LATEST_SUPPORTED_MOBX_MAJOR } from "../constants.js";
import type { ProjectInfo } from "../types/index.js";
import { buildCapabilities } from "./capabilities.js";
import {
  MOBX_REACT_LITE_PACKAGE_NAME,
  MOBX_REACT_OBSERVER_PACKAGE_NAME,
  MOBX_REACT_PACKAGE_NAME,
  MOBX_STATE_TREE_PACKAGE_NAME,
  REACT_ROUTER_DEPENDENCY_NAMES,
  REACT_THREE_FIBER_DEPENDENCY_NAMES,
  REACT_THREE_FIBER_ECOSYSTEM_DEPENDENCY_NAMES,
  TANSTACK_REACT_QUERY_PACKAGE_NAMES,
} from "./capability-dependency-names.js";
import { detectPreES2023Target } from "./detect-pre-es2023-target.js";
import { REACT_SECTIONS, TAILWIND_ZOD_SECTIONS } from "./dependencies.js";
import {
  detectNextjsStaticExport,
  detectReactCompiler,
  detectReactCompilerLintPlugin,
} from "./detectors.js";
import { findPreferredDependency } from "./find-preferred-dependency.js";
import { isFile } from "./fs-utils.js";
import { hasI18nDependency } from "./has-i18n-dependency.js";
import type {
  PackageGraph,
  PackageGraphDependencyDeclaration,
  PackageGraphPackage,
} from "./package-graph.js";
import { isPackageJsonReactNativeAware, isPackageJsonReanimatedAware } from "./rn-metadata.js";
import { isPackageJsonSsrAware } from "./ssr-metadata.js";
import {
  getDependencyMajorWithinSupportedRange,
  getLowestDependencyMajor,
  parseReactMajor,
  parseThreeRelease,
  resolveEffectiveReactMajor,
} from "./version.js";

const getDependencyVersion = (
  packageGraph: PackageGraph,
  packageNode: PackageGraphPackage,
  dependencyName: string,
  sections?: ReadonlyArray<PackageGraphDependencyDeclaration["section"]>,
): string | null => {
  const dependencyDeclaration = packageGraph.getDependency(
    packageNode.directory,
    dependencyName,
    sections,
  );
  if (dependencyDeclaration === null) return null;
  if (dependencyDeclaration.workspaceTargetPackageDirectory === null) {
    return dependencyDeclaration.resolvedSpecifier;
  }
  const workspaceTarget = packageGraph.packages.find(
    (candidatePackage) =>
      candidatePackage.directory === dependencyDeclaration.workspaceTargetPackageDirectory,
  );
  return workspaceTarget?.version ?? dependencyDeclaration.resolvedSpecifier;
};

export const buildPackageCapabilities = (
  packageGraph: PackageGraph,
  packageNode: PackageGraphPackage,
): ReadonlySet<Capability> => {
  const reactVersion = getDependencyVersion(packageGraph, packageNode, "react", REACT_SECTIONS);
  const tailwindVersion = getDependencyVersion(
    packageGraph,
    packageNode,
    "tailwindcss",
    TAILWIND_ZOD_SECTIONS,
  );
  const zodVersion = getDependencyVersion(packageGraph, packageNode, "zod", TAILWIND_ZOD_SECTIONS);
  const mobxVersion = getDependencyVersion(packageGraph, packageNode, "mobx");
  const mobxReactVersion = getDependencyVersion(packageGraph, packageNode, MOBX_REACT_PACKAGE_NAME);
  const mobxReactLiteVersion = getDependencyVersion(
    packageGraph,
    packageNode,
    MOBX_REACT_LITE_PACKAGE_NAME,
  );
  const zustandVersion = getDependencyVersion(packageGraph, packageNode, "zustand");
  const findPackageDependency = (dependencyNames: ReadonlyArray<string>) =>
    findPreferredDependency({
      dependencyNames,
      getValue: (dependencyName) =>
        getDependencyVersion(packageGraph, packageNode, dependencyName, REACT_SECTIONS),
    });
  const tanstackQuery = findPackageDependency(TANSTACK_REACT_QUERY_PACKAGE_NAMES);
  const reactRouter = findPackageDependency(REACT_ROUTER_DEPENDENCY_NAMES);
  const reactThreeFiber = findPackageDependency(REACT_THREE_FIBER_DEPENDENCY_NAMES);
  const preactVersion = getDependencyVersion(packageGraph, packageNode, "preact", REACT_SECTIONS);
  const remotionVersion = getDependencyVersion(packageGraph, packageNode, "remotion");
  const threeVersion = getDependencyVersion(packageGraph, packageNode, "three");
  const valtioVersion = getDependencyVersion(packageGraph, packageNode, "valtio");
  const styledComponentsVersion = getDependencyVersion(
    packageGraph,
    packageNode,
    "styled-components",
    REACT_SECTIONS,
  );
  const hasReactNativePackage =
    packageNode.dependencyInfo.framework === "expo" ||
    packageNode.dependencyInfo.framework === "react-native" ||
    isPackageJsonReactNativeAware(packageNode.manifest);
  const expoVersion = hasReactNativePackage
    ? getDependencyVersion(packageGraph, packageNode, "expo")
    : null;
  const shopifyFlashListVersion = hasReactNativePackage
    ? getDependencyVersion(packageGraph, packageNode, "@shopify/flash-list")
    : null;
  const hasReanimated = hasReactNativePackage && isPackageJsonReanimatedAware(packageNode.manifest);
  const reanimatedVersion = hasReanimated
    ? getDependencyVersion(packageGraph, packageNode, "react-native-reanimated")
    : null;
  const nextjsVersion =
    packageNode.dependencyInfo.framework === "nextjs"
      ? getDependencyVersion(packageGraph, packageNode, "next")
      : null;
  const hasTypeScript = isFile(path.join(packageNode.directory, "tsconfig.json"));
  const hasReactThreeFiber = REACT_THREE_FIBER_ECOSYSTEM_DEPENDENCY_NAMES.some(
    (dependencyName) => getDependencyVersion(packageGraph, packageNode, dependencyName) !== null,
  );
  const projectInfo: ProjectInfo = {
    rootDirectory: packageNode.directory,
    projectName: packageNode.name ?? packageNode.directory,
    reactVersion,
    reactMajorVersion: resolveEffectiveReactMajor(reactVersion, packageNode.manifest),
    tailwindVersion,
    zodVersion,
    zodMajorVersion: zodVersion === null ? null : getLowestDependencyMajor(zodVersion),
    mobxVersion,
    mobxMajorVersion:
      mobxVersion === null
        ? null
        : getDependencyMajorWithinSupportedRange(mobxVersion, LATEST_SUPPORTED_MOBX_MAJOR),
    hasMobxReact: mobxReactVersion !== null,
    mobxReactVersion,
    hasMobxReactLite: mobxReactLiteVersion !== null,
    mobxReactLiteVersion,
    hasMobxStateTree:
      getDependencyVersion(packageGraph, packageNode, MOBX_STATE_TREE_PACKAGE_NAME) !== null,
    hasMobxReactObserver:
      getDependencyVersion(packageGraph, packageNode, MOBX_REACT_OBSERVER_PACKAGE_NAME) !== null,
    zustandVersion,
    zustandMajorVersion: zustandVersion === null ? null : getLowestDependencyMajor(zustandVersion),
    framework: packageNode.dependencyInfo.framework,
    hasTypeScript,
    hasReactCompiler: detectReactCompiler(packageNode.directory, packageNode.manifest),
    hasReactCompilerLintPlugin: detectReactCompilerLintPlugin(
      packageNode.directory,
      packageNode.manifest,
    ),
    hasTanStackQuery: tanstackQuery !== null,
    hasI18nLibrary: hasI18nDependency(packageNode.manifest),
    tanstackQueryVersion: tanstackQuery?.value ?? null,
    styledComponentsVersion,
    valtioVersion,
    valtioMajorVersion: valtioVersion === null ? null : getLowestDependencyMajor(valtioVersion),
    hasRemotion: remotionVersion !== null,
    remotionVersion,
    remotionMajorVersion:
      remotionVersion === null ? null : getLowestDependencyMajor(remotionVersion),
    hasThree: threeVersion !== null || hasReactThreeFiber,
    threeVersion,
    threeRelease: parseThreeRelease(threeVersion),
    hasReactThreeFiber,
    reactThreeFiberVersion: reactThreeFiber?.value ?? null,
    reactThreeFiberMajorVersion:
      reactThreeFiber === null ? null : getLowestDependencyMajor(reactThreeFiber.value),
    hasSsrDependency: isPackageJsonSsrAware(packageNode.manifest),
    preactVersion,
    preactMajorVersion: parseReactMajor(preactVersion),
    hasReactNativeWorkspace: hasReactNativePackage,
    nextjsVersion,
    nextjsMajorVersion: nextjsVersion === null ? null : getLowestDependencyMajor(nextjsVersion),
    reactRouterVersion: reactRouter?.value ?? null,
    hasReactRouterFramework:
      getDependencyVersion(packageGraph, packageNode, "@react-router/dev") !== null,
    expoVersion,
    shopifyFlashListVersion,
    shopifyFlashListMajorVersion:
      shopifyFlashListVersion === null ? null : getLowestDependencyMajor(shopifyFlashListVersion),
    hasReanimated,
    reanimatedVersion,
    isPreES2023Target: hasTypeScript && detectPreES2023Target(packageNode.directory),
    isStaticExport:
      packageNode.dependencyInfo.framework === "nextjs" &&
      detectNextjsStaticExport(packageNode.directory),
    sourceFileCount: 0,
  };
  return buildCapabilities(projectInfo);
};
