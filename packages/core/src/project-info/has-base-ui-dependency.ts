import type { PackageJson } from "../types/index.js";

// The pre-1.0 package name and the 1.0 rename — both resolve the same
// component namespaces (`@base-ui-components/react/dialog` /
// `@base-ui/react/dialog`).
const BASE_UI_PACKAGES = ["@base-ui-components/react", "@base-ui/react"];

export const hasBaseUiDependency = (packageJson: PackageJson): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  };
  return BASE_UI_PACKAGES.some((packageName) => allDependencies[packageName] !== undefined);
};
