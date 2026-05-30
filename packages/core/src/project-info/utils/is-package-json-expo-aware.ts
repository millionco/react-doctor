import type { PackageJson } from "../../types/index.js";
import { isExpoManagedDependencyName } from "../internal-rn-dependency-names.js";

const containsAnyExpoManagedDependency = (section: Record<string, string> | undefined): boolean => {
  if (!section) return false;
  for (const dependencyName of Object.keys(section)) {
    if (isExpoManagedDependencyName(dependencyName)) return true;
  }
  return false;
};

// True when the manifest declares any canonical Expo-managed package
// (`expo`, `expo-router`, `@expo/cli`, …). This is the project-discovery
// twin of the plugin's `isExpoManaged` file gate, so the project-level
// `expo` capability and the file-level `isExpoManagedFileActive` gate stay
// in agreement. Iterates the same four dependency sections as the React
// Native gate so an Expo dep in any section counts.
export const isPackageJsonExpoAware = (packageJson: PackageJson): boolean => {
  if (containsAnyExpoManagedDependency(packageJson.dependencies)) return true;
  if (containsAnyExpoManagedDependency(packageJson.devDependencies)) return true;
  if (containsAnyExpoManagedDependency(packageJson.peerDependencies)) return true;
  if (containsAnyExpoManagedDependency(packageJson.optionalDependencies)) return true;
  return false;
};
