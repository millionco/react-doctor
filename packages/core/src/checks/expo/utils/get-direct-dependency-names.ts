import type { PackageJson } from "../../../types/index.js";

// The names declared in `dependencies` + `devDependencies` — the two
// sections expo-doctor treats as "installed directly in your project".
// Peer / optional dependencies are excluded on purpose: a package only
// listed there is not something the user installed directly.
export const getDirectDependencyNames = (packageJson: PackageJson): ReadonlySet<string> =>
  new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);
