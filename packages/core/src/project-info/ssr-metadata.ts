import type { PackageJson } from "../types/index.js";

const SSR_DEPENDENCY_NAMES = new Set([
  "@react-router/cloudflare",
  "@react-router/node",
  "@react-router/serve",
  "vike",
  "vite-plugin-ssr",
]);

export const isPackageJsonSsrAware = (packageJson: PackageJson): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  };
  return Object.keys(allDependencies).some((packageName) => SSR_DEPENDENCY_NAMES.has(packageName));
};
