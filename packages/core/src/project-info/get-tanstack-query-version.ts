import type { PackageJson } from "../types/index.js";
import { TANSTACK_REACT_QUERY_PACKAGE_NAMES } from "./capability-dependency-names.js";
import { getPreferredDependencyVersion } from "./get-preferred-dependency-version.js";

export const getTanStackQueryVersion = (packageJson: PackageJson): string | null => {
  return getPreferredDependencyVersion({
    packageJson,
    packageNames: TANSTACK_REACT_QUERY_PACKAGE_NAMES,
  });
};
