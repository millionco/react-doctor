import type { PackageJson } from "../types/index.js";

export const getNextjsVersion = (packageJson: PackageJson): string | null => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return allDependencies.next ?? null;
};
