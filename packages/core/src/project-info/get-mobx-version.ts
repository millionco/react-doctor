import type { PackageJson } from "../types/index.js";
import { getPreferredDependencyVersion } from "./get-preferred-dependency-version.js";

// Ordered so the core `mobx` spec wins when present; the binding packages
// (`mobx-react`, `mobx-react-lite`) and `mobx-state-tree` still flag a MobX
// project when core isn't declared directly (it arrives transitively).
const MOBX_PACKAGES = ["mobx", "mobx-react", "mobx-react-lite", "mobx-state-tree"];

export const getMobxVersion = (packageJson: PackageJson): string | null => {
  return getPreferredDependencyVersion({ packageJson, packageNames: MOBX_PACKAGES });
};
