import * as path from "node:path";
import type { Capability } from "oxlint-plugin-react-doctor/contracts";
import type { DependencyInfo, PackageJson } from "../types/index.js";
import {
  extractCatalogName,
  extractDependencyInfo,
  hasReactDependency,
  resolveCatalogBackedDependency,
} from "./dependencies.js";
import { buildPackageCapabilities } from "./build-package-capabilities.js";
import { isPlainObject } from "./fs-utils.js";
import { readPackageJson } from "./package-json.js";
import { doesDependencyVersionIntersectRange } from "./version.js";
import { getWorkspacePatterns, resolveWorkspaceDirectories } from "./workspaces.js";

const WORKSPACE_PROTOCOL_PREFIX = "workspace:";
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

export interface PackageGraphDependencyDeclaration {
  readonly declaringPackageDirectory: string;
  readonly packageName: string;
  readonly section:
    | "dependencies"
    | "devDependencies"
    | "peerDependencies"
    | "optionalDependencies";
  readonly rawSpecifier: string;
  readonly resolvedSpecifier: string;
  readonly catalogReference: string | null;
  readonly resolutionSource:
    | "manifest"
    | "declaring-package-catalog"
    | "workspace-root-catalog"
    | "monorepo-root-catalog"
    | "unresolved-catalog";
  readonly resolutionSourceDirectory: string | null;
  readonly workspaceTargetPackageDirectory: string | null;
}

export interface PackageGraphWorkspaceEdge {
  readonly sourcePackageDirectory: string;
  readonly targetPackageDirectory: string;
  readonly targetPackageVersion: string | null;
  readonly dependencyName: string;
  readonly section:
    | "dependencies"
    | "devDependencies"
    | "peerDependencies"
    | "optionalDependencies";
  readonly workspaceSpecifier: string;
}

export interface PackageGraphPackage {
  readonly directory: string;
  readonly manifestPath: string;
  readonly name: string | null;
  readonly version: string | null;
  readonly isRoot: boolean;
  readonly hasReactDependency: boolean;
  readonly manifest: PackageJson;
  readonly dependencyInfo: DependencyInfo;
  readonly dependencyDeclarations: ReadonlyArray<PackageGraphDependencyDeclaration>;
}

export interface PackageGraph {
  readonly rootDirectory: string;
  readonly rootPackage: PackageGraphPackage;
  readonly packages: ReadonlyArray<PackageGraphPackage>;
  readonly workspacePatterns: ReadonlyArray<string>;
  readonly workspaceEdges: ReadonlyArray<PackageGraphWorkspaceEdge>;
  readonly getCapabilities: (packageDirectory: string) => ReadonlySet<Capability> | null;
  readonly getCapabilitiesForFile: (filePath: string) => ReadonlySet<Capability> | null;
  readonly findOwningPackage: (
    filePath: string,
    predicate?: (packageNode: PackageGraphPackage) => boolean,
  ) => PackageGraphPackage | null;
  readonly getDependency: (
    packageDirectory: string,
    dependencyName: string,
    sections?: ReadonlyArray<
      "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies"
    >,
  ) => PackageGraphDependencyDeclaration | null;
  readonly getDependencyDeclarations: (
    packageDirectory: string,
    dependencyName: string,
  ) => ReadonlyArray<PackageGraphDependencyDeclaration>;
  readonly hasDependency: (
    packageDirectory: string,
    dependencyName: string,
    versionRange?: string,
  ) => boolean;
}

interface BuildPackageGraphNodeOptions {
  readonly directory: string;
  readonly isRoot: boolean;
  readonly manifest: PackageJson;
  readonly rootDirectory: string;
  readonly rootPackageJson: PackageJson;
}

const buildPackageGraphNode = ({
  directory,
  isRoot,
  manifest,
  rootDirectory,
  rootPackageJson,
}: BuildPackageGraphNodeOptions): PackageGraphPackage => {
  const dependencyDeclarations: PackageGraphDependencyDeclaration[] = [];

  for (const section of DEPENDENCY_SECTIONS) {
    const dependencies = manifest[section];
    if (!isPlainObject(dependencies)) continue;

    for (const [packageName, rawSpecifier] of Object.entries(dependencies)) {
      if (typeof rawSpecifier !== "string") continue;
      const resolution = resolveCatalogBackedDependency({
        rootDirectory,
        rootPackageJson,
        sourceDirectory: directory,
        sourcePackageJson: manifest,
        packageName,
        version: rawSpecifier,
      });
      if (resolution.resolvedVersion === null || resolution.resolutionSource === "none") continue;

      dependencyDeclarations.push({
        declaringPackageDirectory: directory,
        packageName,
        section,
        rawSpecifier,
        resolvedSpecifier: resolution.resolvedVersion,
        catalogReference: extractCatalogName(rawSpecifier),
        resolutionSource: resolution.resolutionSource,
        resolutionSourceDirectory: resolution.resolutionSourceDirectory,
        workspaceTargetPackageDirectory: null,
      });
    }
  }

  return {
    directory,
    manifestPath: path.join(directory, "package.json"),
    name: typeof manifest.name === "string" ? manifest.name : null,
    version: typeof manifest.version === "string" ? manifest.version : null,
    isRoot,
    hasReactDependency: hasReactDependency(manifest),
    manifest,
    dependencyInfo: extractDependencyInfo(manifest),
    dependencyDeclarations,
  };
};

const isPathInsideDirectory = (filePath: string, directory: string): boolean => {
  const relativePath = path.relative(directory, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
};

const getWorkspaceSpecifier = (
  dependencyDeclaration: PackageGraphDependencyDeclaration,
): string | null => {
  if (dependencyDeclaration.rawSpecifier.startsWith(WORKSPACE_PROTOCOL_PREFIX)) {
    return dependencyDeclaration.rawSpecifier;
  }
  if (dependencyDeclaration.resolvedSpecifier.startsWith(WORKSPACE_PROTOCOL_PREFIX)) {
    return dependencyDeclaration.resolvedSpecifier;
  }
  return null;
};

export const buildPackageGraph = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
): PackageGraph => {
  const normalizedRootDirectory = path.normalize(rootDirectory);
  const workspacePatterns = getWorkspacePatterns(normalizedRootDirectory, rootPackageJson);
  const unresolvedRootPackage = buildPackageGraphNode({
    directory: normalizedRootDirectory,
    isRoot: true,
    manifest: rootPackageJson,
    rootDirectory: normalizedRootDirectory,
    rootPackageJson,
  });
  const unresolvedPackages: PackageGraphPackage[] = [unresolvedRootPackage];
  const visitedDirectories = new Set<string>([normalizedRootDirectory]);

  for (const pattern of workspacePatterns) {
    const workspaceDirectories = resolveWorkspaceDirectories(
      normalizedRootDirectory,
      pattern,
    ).toSorted();
    for (const workspaceDirectory of workspaceDirectories) {
      const normalizedWorkspaceDirectory = path.normalize(workspaceDirectory);
      if (visitedDirectories.has(normalizedWorkspaceDirectory)) continue;
      visitedDirectories.add(normalizedWorkspaceDirectory);
      const manifest = readPackageJson(path.join(normalizedWorkspaceDirectory, "package.json"));
      unresolvedPackages.push(
        buildPackageGraphNode({
          directory: normalizedWorkspaceDirectory,
          isRoot: false,
          manifest,
          rootDirectory: normalizedRootDirectory,
          rootPackageJson,
        }),
      );
    }
  }

  const packagesByName = new Map<string, PackageGraphPackage[]>();
  for (const packageNode of unresolvedPackages) {
    if (packageNode.name === null) continue;
    const matchingPackages = packagesByName.get(packageNode.name) ?? [];
    matchingPackages.push(packageNode);
    packagesByName.set(packageNode.name, matchingPackages);
  }

  const resolvePackageWorkspaceTargets = (
    packageNode: PackageGraphPackage,
  ): PackageGraphPackage => ({
    ...packageNode,
    dependencyDeclarations: packageNode.dependencyDeclarations.map(
      (dependencyDeclaration): PackageGraphDependencyDeclaration => {
        if (getWorkspaceSpecifier(dependencyDeclaration) === null) return dependencyDeclaration;
        const matchingPackages = packagesByName.get(dependencyDeclaration.packageName) ?? [];
        if (
          matchingPackages.length !== 1 ||
          matchingPackages[0].directory === packageNode.directory
        ) {
          return dependencyDeclaration;
        }
        return {
          ...dependencyDeclaration,
          workspaceTargetPackageDirectory: matchingPackages[0].directory,
        };
      },
    ),
  });
  const rootPackage = resolvePackageWorkspaceTargets(unresolvedRootPackage);
  const packages = [
    rootPackage,
    ...unresolvedPackages.slice(1).map(resolvePackageWorkspaceTargets),
  ];
  const packagesByDirectory = new Map(
    packages.map((packageNode) => [packageNode.directory, packageNode]),
  );
  const packagesByDescendingDirectoryLength = packages.toSorted(
    (leftPackage, rightPackage) => rightPackage.directory.length - leftPackage.directory.length,
  );
  const workspaceEdges: PackageGraphWorkspaceEdge[] = [];
  for (const packageNode of packages) {
    for (const dependencyDeclaration of packageNode.dependencyDeclarations) {
      const workspaceSpecifier = getWorkspaceSpecifier(dependencyDeclaration);
      const targetPackageDirectory = dependencyDeclaration.workspaceTargetPackageDirectory;
      if (workspaceSpecifier === null || targetPackageDirectory === null) continue;
      const targetPackage = packagesByDirectory.get(targetPackageDirectory);
      if (!targetPackage) continue;
      workspaceEdges.push({
        sourcePackageDirectory: packageNode.directory,
        targetPackageDirectory,
        targetPackageVersion: targetPackage.version,
        dependencyName: dependencyDeclaration.packageName,
        section: dependencyDeclaration.section,
        workspaceSpecifier,
      });
    }
  }
  const dependencyDeclarationsByPackageDirectory = new Map<
    string,
    Map<string, PackageGraphDependencyDeclaration[]>
  >();
  for (const packageNode of packages) {
    const dependencyDeclarationsByName = new Map<string, PackageGraphDependencyDeclaration[]>();
    for (const dependencyDeclaration of packageNode.dependencyDeclarations) {
      const matchingDeclarations =
        dependencyDeclarationsByName.get(dependencyDeclaration.packageName) ?? [];
      matchingDeclarations.push(dependencyDeclaration);
      dependencyDeclarationsByName.set(dependencyDeclaration.packageName, matchingDeclarations);
    }
    dependencyDeclarationsByPackageDirectory.set(
      packageNode.directory,
      dependencyDeclarationsByName,
    );
  }
  const getDependencyDeclarations = (
    packageDirectory: string,
    dependencyName: string,
  ): ReadonlyArray<PackageGraphDependencyDeclaration> =>
    dependencyDeclarationsByPackageDirectory
      .get(path.normalize(packageDirectory))
      ?.get(dependencyName) ?? [];
  const getDependency = (
    packageDirectory: string,
    dependencyName: string,
    sections?: ReadonlyArray<
      "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies"
    >,
  ): PackageGraphDependencyDeclaration | null => {
    const dependencyDeclarations = getDependencyDeclarations(packageDirectory, dependencyName);
    if (sections === undefined) return dependencyDeclarations[0] ?? null;
    for (const section of sections) {
      const matchingDeclaration = dependencyDeclarations.find(
        (dependencyDeclaration) => dependencyDeclaration.section === section,
      );
      if (matchingDeclaration) return matchingDeclaration;
    }
    return null;
  };
  const findOwningPackage = (
    filePath: string,
    predicate?: (packageNode: PackageGraphPackage) => boolean,
  ): PackageGraphPackage | null => {
    const normalizedFilePath = path.normalize(filePath);
    return (
      packagesByDescendingDirectoryLength.find(
        (packageNode) =>
          (predicate === undefined || predicate(packageNode)) &&
          isPathInsideDirectory(normalizedFilePath, packageNode.directory),
      ) ?? null
    );
  };
  const capabilitiesByPackageDirectory = new Map<string, ReadonlySet<Capability>>();
  const packageGraph: PackageGraph = {
    rootDirectory: normalizedRootDirectory,
    rootPackage,
    packages,
    workspacePatterns,
    workspaceEdges,
    getCapabilities: (packageDirectory) => {
      const normalizedPackageDirectory = path.normalize(packageDirectory);
      const packageNode = packagesByDirectory.get(normalizedPackageDirectory);
      if (packageNode === undefined) return null;
      const cachedCapabilities = capabilitiesByPackageDirectory.get(normalizedPackageDirectory);
      if (cachedCapabilities !== undefined) return cachedCapabilities;
      const capabilities = buildPackageCapabilities(packageGraph, packageNode);
      capabilitiesByPackageDirectory.set(normalizedPackageDirectory, capabilities);
      return capabilities;
    },
    getCapabilitiesForFile: (filePath) => {
      const owningPackage = findOwningPackage(filePath);
      return owningPackage === null ? null : packageGraph.getCapabilities(owningPackage.directory);
    },
    findOwningPackage,
    getDependency,
    getDependencyDeclarations,
    hasDependency: (packageDirectory, dependencyName, versionRange) => {
      const dependencyDeclaration = getDependency(packageDirectory, dependencyName);
      if (dependencyDeclaration === null) return false;
      if (versionRange === undefined) return true;

      const workspaceTarget =
        dependencyDeclaration.workspaceTargetPackageDirectory === null
          ? null
          : (packagesByDirectory.get(dependencyDeclaration.workspaceTargetPackageDirectory) ??
            null);
      const dependencyVersion = workspaceTarget?.version ?? dependencyDeclaration.resolvedSpecifier;
      return doesDependencyVersionIntersectRange(dependencyVersion, versionRange);
    },
  };
  return packageGraph;
};
