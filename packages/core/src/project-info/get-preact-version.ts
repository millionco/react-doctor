import type { PackageJson } from "../types/index.js";

export const getPreactVersion = (packageJson: PackageJson): string | null => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return typeof allDependencies.preact === "string" ? allDependencies.preact : null;
};
