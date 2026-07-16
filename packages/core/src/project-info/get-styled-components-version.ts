import type { PackageJson } from "../types/index.js";

export const getStyledComponentsVersion = (packageJson: PackageJson): string | null => {
  // devDependencies lowest, runtime dependencies highest: a dev-only pin
  // must not override the spec the shipped app actually resolves.
  const allDependencies = {
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
  };
  return allDependencies["styled-components"] ?? null;
};
