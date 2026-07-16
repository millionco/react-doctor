import type { PackageJson } from "../types/index.js";

// Ordered by preference: the React binding first (what a component tree
// actually imports), then the framework-agnostic core, then the legacy
// pre-TanStack package name.
const TANSTACK_QUERY_PACKAGES = ["@tanstack/react-query", "@tanstack/query-core", "react-query"];

export const getTanStackQueryVersion = (packageJson: PackageJson): string | null => {
  // devDependencies lowest, runtime dependencies highest: a dev-only pin
  // must not override the spec the shipped app actually resolves.
  const allDependencies = {
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
  };
  for (const packageName of TANSTACK_QUERY_PACKAGES) {
    const version = allDependencies[packageName];
    if (version !== undefined) return version;
  }
  return null;
};
