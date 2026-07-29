import * as fs from "node:fs";
import * as path from "node:path";
import type { Capability } from "oxlint-plugin-react-doctor/contracts";
import type {
  PackageGraph,
  PackageGraphDependencyDeclaration,
} from "../../project-info/package-graph.js";

export interface OxlintPackageDependencySetting {
  readonly name: string;
  readonly section: PackageGraphDependencyDeclaration["section"];
  readonly rawSpecifier: string;
  readonly resolvedSpecifier: string;
}

export interface OxlintPackageContextSetting {
  readonly relativeDirectory: string;
  readonly capabilities: ReadonlyArray<Capability>;
  readonly dependencies: ReadonlyArray<OxlintPackageDependencySetting>;
}

const resolveRealDirectory = (directory: string): string => {
  if (!fs.existsSync(directory)) return directory;
  return fs.realpathSync(directory);
};

export const buildPackageContextSettings = (
  packageGraph: PackageGraph,
  settingsRootDirectory: string,
): ReadonlyArray<OxlintPackageContextSetting> => {
  const packageVersionByDirectory = new Map(
    packageGraph.packages.map((packageNode) => [packageNode.directory, packageNode.version]),
  );
  return packageGraph.packages
    .map((packageNode): OxlintPackageContextSetting => {
      const packageCapabilities =
        packageGraph.getCapabilities(packageNode.directory) ?? new Set<Capability>();
      return {
        relativeDirectory: path
          .relative(settingsRootDirectory, resolveRealDirectory(packageNode.directory))
          .replaceAll("\\", "/"),
        capabilities: [...packageCapabilities].sort(),
        dependencies: packageNode.dependencyDeclarations
          .map(
            (dependencyDeclaration): OxlintPackageDependencySetting => ({
              name: dependencyDeclaration.packageName,
              section: dependencyDeclaration.section,
              rawSpecifier: dependencyDeclaration.rawSpecifier,
              resolvedSpecifier:
                dependencyDeclaration.workspaceTargetPackageDirectory === null
                  ? dependencyDeclaration.resolvedSpecifier
                  : (packageVersionByDirectory.get(
                      dependencyDeclaration.workspaceTargetPackageDirectory,
                    ) ?? dependencyDeclaration.resolvedSpecifier),
            }),
          )
          .toSorted((leftDependency, rightDependency) =>
            leftDependency.name.localeCompare(rightDependency.name),
          ),
      };
    })
    .toSorted((leftPackage, rightPackage) =>
      leftPackage.relativeDirectory.localeCompare(rightPackage.relativeDirectory),
    );
};
