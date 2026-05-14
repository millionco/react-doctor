import type { PackageJson } from "../../types.js";
import { collectAllDependencies } from "./collect-all-dependencies.js";

const TANSTACK_QUERY_PACKAGES = new Set([
  "@tanstack/react-query",
  "@tanstack/query-core",
  "react-query",
]);

export const hasTanStackQuery = (packageJson: PackageJson): boolean => {
  const allDependencies = collectAllDependencies(packageJson);
  return Object.keys(allDependencies).some((packageName) =>
    TANSTACK_QUERY_PACKAGES.has(packageName),
  );
};
