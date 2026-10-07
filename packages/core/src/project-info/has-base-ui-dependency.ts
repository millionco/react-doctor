import type { PackageJson } from "../types/index.js";
import { hasAnyDependency } from "./has-any-dependency.js";

// The pre-1.0 package name and the 1.0 rename — both resolve the same
// component namespaces (`@base-ui-components/react/dialog` /
// `@base-ui/react/dialog`).
const BASE_UI_PACKAGES = ["@base-ui-components/react", "@base-ui/react"];

export const hasBaseUiDependency = (packageJson: PackageJson): boolean =>
  hasAnyDependency(packageJson, BASE_UI_PACKAGES);
