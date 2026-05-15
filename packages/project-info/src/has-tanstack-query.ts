import type { PackageJson } from "@react-doctor/types";

const TANSTACK_QUERY_PACKAGES = new Set([
  "@tanstack/react-query",
  "@tanstack/query-core",
  "react-query",
]);

export const hasTanStackQuery = (packageJson: PackageJson): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return Object.keys(allDependencies).some((packageName) =>
    TANSTACK_QUERY_PACKAGES.has(packageName),
  );
};
