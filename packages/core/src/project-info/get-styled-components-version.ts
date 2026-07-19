import type { PackageJson } from "../types/index.js";
import { getPreferredDependencyVersion } from "./get-preferred-dependency-version.js";

const STYLED_COMPONENTS_PACKAGES = ["styled-components"];

export const getStyledComponentsVersion = (packageJson: PackageJson): string | null => {
  return getPreferredDependencyVersion({
    packageJson,
    packageNames: STYLED_COMPONENTS_PACKAGES,
  });
};
