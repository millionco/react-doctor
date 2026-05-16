import type { PackageJson } from "@react-doctor/types";

// Known package names that mean "this manifest targets React Native".
// Kept in sync with `oxlint-plugin-react-doctor`'s
// `classify-package-platform.ts` so the file-level rule gate and the
// project-level capability gate agree about what counts as RN.
// `react-native-web` is deliberately absent — it's a DOM compat layer
// that lives in web hosts (Next / Vite), not a mobile target.
const REACT_NATIVE_DEPENDENCY_NAMES: ReadonlySet<string> = new Set([
  "react-native",
  "react-native-tvos",
  "expo",
  "expo-router",
  "@expo/cli",
  "@expo/metro-config",
  "@expo/metro-runtime",
  "react-native-windows",
  "react-native-macos",
]);

const REACT_NATIVE_DEPENDENCY_PREFIXES: ReadonlyArray<string> = [
  "@react-native/",
  "@react-native-",
];

interface PackageJsonWithReactNativeField extends PackageJson {
  "react-native"?: unknown;
}

const matchesReactNativeNamespace = (dependencyName: string): boolean =>
  REACT_NATIVE_DEPENDENCY_PREFIXES.some((prefix) => dependencyName.startsWith(prefix));

const containsAnyReactNativeDependency = (section: Record<string, string> | undefined): boolean => {
  if (!section) return false;
  for (const dependencyName of Object.keys(section)) {
    if (REACT_NATIVE_DEPENDENCY_NAMES.has(dependencyName)) return true;
    if (matchesReactNativeNamespace(dependencyName)) return true;
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
export const isPackageJsonReactNativeAware = (packageJson: PackageJson): boolean => {
  const packageJsonWithField: PackageJsonWithReactNativeField = packageJson;
  if (typeof packageJsonWithField["react-native"] === "string") return true;
  if (containsAnyReactNativeDependency(packageJson.dependencies)) return true;
  if (containsAnyReactNativeDependency(packageJson.devDependencies)) return true;
  if (containsAnyReactNativeDependency(packageJson.peerDependencies)) return true;
  return false;
};
