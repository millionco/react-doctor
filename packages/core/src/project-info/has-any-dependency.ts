import type { PackageJson } from "../types/index.js";

// True when any of `packageNames` is declared in any dependency section.
// The shared shape behind the boolean library predicates (`hasBaseUi`,
// `hasReactAriaComponents`, …) that gate capability-scoped rule families.
export const hasAnyDependency = (
  packageJson: PackageJson,
  packageNames: ReadonlyArray<string>,
): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  };
  return packageNames.some((packageName) => allDependencies[packageName] !== undefined);
};
