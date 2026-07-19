import type { PackageJson } from "../types/index.js";
import { getPreferredDependencyVersion } from "./get-preferred-dependency-version.js";

const TANSTACK_REACT_QUERY_PACKAGES = ["@tanstack/react-query", "react-query"];

export const getTanStackQueryVersion = (packageJson: PackageJson): string | null => {
  return getPreferredDependencyVersion({
    packageJson,
    packageNames: TANSTACK_REACT_QUERY_PACKAGES,
  });
};
