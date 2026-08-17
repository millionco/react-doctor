import type { PackageJson } from "../types/index.js";

const RADIX_UNIFIED_PACKAGE = "radix-ui";
const RADIX_PRIMITIVE_PACKAGE_PREFIX = "@radix-ui/react-";
// Icons carry no composition contract — an icons-only project should not
// switch on the primitive composition rules.
const RADIX_NON_PRIMITIVE_PACKAGES = new Set(["@radix-ui/react-icons"]);

// Declaring the unified `radix-ui` package or any `@radix-ui/react-*`
// primitive is the package.json signal that the app composes Radix parts
// directly (as opposed to through generated shadcn files, which the
// separate `shadcn` capability covers).
export const hasRadixUiDependency = (packageJson: PackageJson): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  };
  return Object.keys(allDependencies).some(
    (packageName) =>
      packageName === RADIX_UNIFIED_PACKAGE ||
      (packageName.startsWith(RADIX_PRIMITIVE_PACKAGE_PREFIX) &&
        !RADIX_NON_PRIMITIVE_PACKAGES.has(packageName)),
  );
};
