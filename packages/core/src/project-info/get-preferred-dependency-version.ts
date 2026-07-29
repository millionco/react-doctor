import type { PackageJson } from "../types/index.js";
import { getDependencyDeclaration } from "./dependencies.js";
import { findPreferredDependency } from "./find-preferred-dependency.js";

const PREFERRED_DEPENDENCY_SECTIONS: ReadonlyArray<
  "dependencies" | "peerDependencies" | "devDependencies"
> = ["dependencies", "peerDependencies", "devDependencies"];

interface GetPreferredDependencyVersionOptions {
  packageJson: PackageJson;
  packageNames: ReadonlyArray<string>;
}

export const getPreferredDependencyVersion = ({
  packageJson,
  packageNames,
}: GetPreferredDependencyVersionOptions): string | null =>
  findPreferredDependency({
    dependencyNames: packageNames,
    getValue: (packageName) =>
      getDependencyDeclaration({
        packageJson,
        packageName,
        sections: PREFERRED_DEPENDENCY_SECTIONS,
      }).version,
  })?.value ?? null;
