import type { PackageJson } from "../types/index.js";
import { getDependencyDeclaration, REACT_SECTIONS } from "./dependencies.js";

interface GetPreferredDependencyVersionOptions {
  packageJson: PackageJson;
  packageNames: ReadonlyArray<string>;
}

export const getPreferredDependencyVersion = ({
  packageJson,
  packageNames,
}: GetPreferredDependencyVersionOptions): string | null => {
  for (const packageName of packageNames) {
    const declaration = getDependencyDeclaration({
      packageJson,
      packageName,
      sections: REACT_SECTIONS,
    });
    if (declaration.version !== null) return declaration.version;
  }
  return null;
};
