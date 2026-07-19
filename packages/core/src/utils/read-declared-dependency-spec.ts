import type { PackageJson } from "../types/index.js";

export const readDeclaredDependencySpec = (
  packageJson: PackageJson,
  packageName: string,
): string | null =>
  packageJson.dependencies?.[packageName] ??
  packageJson.devDependencies?.[packageName] ??
  packageJson.peerDependencies?.[packageName] ??
  packageJson.optionalDependencies?.[packageName] ??
  null;
