import type { PackageJson } from "../types/index.js";

export const getStyledComponentsVersion = (packageJson: PackageJson): string | null => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return allDependencies["styled-components"] ?? null;
};
