import type { PackageJson } from "../../types/index.js";

// Malformed non-string entries must not reach downstream version parsing.
export const getDependencySpec = (packageJson: PackageJson, packageName: string): string | null => {
  const spec =
    packageJson.dependencies?.[packageName] ??
    packageJson.devDependencies?.[packageName] ??
    packageJson.peerDependencies?.[packageName] ??
    packageJson.optionalDependencies?.[packageName];
  return typeof spec === "string" ? spec : null;
};
