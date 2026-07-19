import type { PackageJson } from "../types/index.js";

interface GetPreferredDependencyVersionOptions {
  packageJson: PackageJson;
  packageNames: ReadonlyArray<string>;
}

export const getPreferredDependencyVersion = ({
  packageJson,
  packageNames,
}: GetPreferredDependencyVersionOptions): string | null => {
  const allDependencies = {
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
  };
  for (const packageName of packageNames) {
    const version = allDependencies[packageName];
    if (version !== undefined) return version;
  }
  return null;
};
