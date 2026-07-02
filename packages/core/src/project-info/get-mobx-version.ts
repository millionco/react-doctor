import type { PackageJson } from "../types/index.js";

// Ordered so the core `mobx` spec wins when present; the binding packages
// (`mobx-react`, `mobx-react-lite`) and `mobx-state-tree` still flag a MobX
// project when core isn't declared directly (it arrives transitively).
const MOBX_PACKAGES = ["mobx", "mobx-react", "mobx-react-lite", "mobx-state-tree"];

export const getMobxVersion = (packageJson: PackageJson): string | null => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  for (const packageName of MOBX_PACKAGES) {
    const version = allDependencies[packageName];
    if (version !== undefined) return version;
  }
  return null;
};
