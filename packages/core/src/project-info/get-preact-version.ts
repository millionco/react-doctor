import type { PackageJson } from "../types/index.js";

export const getPreactVersion = (packageJson: PackageJson): string | null => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return allDependencies.preact ?? null;
};
