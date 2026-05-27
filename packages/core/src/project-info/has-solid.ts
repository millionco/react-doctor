import type { PackageJson } from "../types/index.js";

const SOLID_PACKAGES = new Set(["solid-js", "solid-start", "@solidjs/start", "@solidjs/router"]);

export const hasSolid = (packageJson: PackageJson): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return Object.keys(allDependencies).some((packageName) => SOLID_PACKAGES.has(packageName));
};
