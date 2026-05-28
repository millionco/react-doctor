import type { PackageJson } from "../types/index.js";

export const hasPreact = (packageJson: PackageJson): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return "preact" in allDependencies;
};
