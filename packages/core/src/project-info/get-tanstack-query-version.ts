import type { PackageJson } from "../types/index.js";
import { getPreferredDependencyVersion } from "./get-preferred-dependency-version.js";

// Ordered by preference: the React binding first (what a component tree
// actually imports), then the framework-agnostic core, then the legacy
// pre-TanStack package name.
const TANSTACK_QUERY_PACKAGES = ["@tanstack/react-query", "@tanstack/query-core", "react-query"];

export const getTanStackQueryVersion = (packageJson: PackageJson): string | null => {
  return getPreferredDependencyVersion({ packageJson, packageNames: TANSTACK_QUERY_PACKAGES });
};
