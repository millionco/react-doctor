import { isReactNativeDependencyName, type PackageJson } from "@react-doctor/types";

interface PackageJsonWithReactNativeField extends PackageJson {
  "react-native"?: unknown;
}

const containsAnyReactNativeDependency = (section: Record<string, string> | undefined): boolean => {
  if (!section) return false;
  for (const dependencyName of Object.keys(section)) {
    if (isReactNativeDependencyName(dependencyName)) return true;
  }
  return false;
};

// True when the manifest declares any of the canonical React Native or
// Expo packages — or sets Metro's top-level `react-native` resolution
// field. Used to surface a project-level `react-native` capability
// even when the framework hint at the entry point is web-only, so
// `rn-*` rules load on a web-rooted monorepo whose sibling
// workspace targets RN. The file-level package boundary still keeps
// those rules quiet on the web workspaces.
//
// Iterates the same four dependency sections as
// `oxlint-plugin-react-doctor`'s `classifyPackagePlatform` — keeping
// the project-level capability gate and the file-level rule gate in
// agreement so a workspace listing `react-native` only in
// `optionalDependencies` (or any other section) classifies the same
// way in both layers.
export const isPackageJsonReactNativeAware = (packageJson: PackageJson): boolean => {
  const packageJsonWithField: PackageJsonWithReactNativeField = packageJson;
  if (typeof packageJsonWithField["react-native"] === "string") return true;
  if (containsAnyReactNativeDependency(packageJson.dependencies)) return true;
  if (containsAnyReactNativeDependency(packageJson.devDependencies)) return true;
  if (containsAnyReactNativeDependency(packageJson.peerDependencies)) return true;
  if (containsAnyReactNativeDependency(packageJson.optionalDependencies)) return true;
  return false;
};
