import type { PackageJson } from "../types/index.js";
import { getDependencyDeclaration } from "./dependencies.js";

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
}: GetPreferredDependencyVersionOptions): string | null => {
  for (const packageName of packageNames) {
    const declaration = getDependencyDeclaration({
      packageJson,
      packageName,
      sections: PREFERRED_DEPENDENCY_SECTIONS,
    });
    if (declaration.version !== null) return declaration.version;
  }
  return null;
};
