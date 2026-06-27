import type { PackageJson } from "../types/index.js";

// Project-discovery-side copy of the canonical RN-aware-manifest
// detection rules. **Intentionally duplicated** with
// `oxlint-plugin-react-doctor/src/react-native-dependency-names.ts`
// — the file there is the authoritative source for the rule gate;
// this one is the equivalent leaf for the workspace-discovery
// gate, kept local so importing `@react-doctor/core`'s discovery
// helpers (`discoverProject`, `discoverReactSubprojects`, …) does
// NOT also pull the entire 286-rule oxlint plugin into the bundle.
//
// Keep the two lists in sync when adding a new RN/Expo package — a
// regression test in oxlint-plugin and the
// `isPackageJsonReactNativeAware` tests both observe the union.
// `react-native-web` is intentionally NOT included — it's a DOM
// compat layer that pairs with `react-dom` / Next / Vite hosts,
// not a mobile target.

// Closed set of canonical Expo-managed dependency names — the subset of
// the RN cohort that marks a manifest as an *Expo* app specifically.
// Mirrors `EXPO_MANAGED_DEPENDENCY_NAMES` in
// `oxlint-plugin-react-doctor/src/react-native-dependency-names.ts`.
const EXPO_MANAGED_NAMES: ReadonlySet<string> = new Set([
  "expo",
  "expo-router",
  "@expo/cli",
  "@expo/metro-config",
  "@expo/metro-runtime",
]);

const NAMES: ReadonlySet<string> = new Set([
  "react-native",
  "react-native-tvos",
  ...EXPO_MANAGED_NAMES,
  "react-native-windows",
  "react-native-macos",
]);

const PREFIXES: ReadonlyArray<string> = ["@react-native/", "@react-native-"];

export const isReactNativeDependencyName = (dependencyName: string): boolean => {
  if (NAMES.has(dependencyName)) return true;
  for (const prefix of PREFIXES) {
    if (dependencyName.startsWith(prefix)) return true;
  }
  return false;
};

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

// `react-native-reanimated` ships `.get()` / `.set()` accessors as the
// React Compiler-compatible alternative to `.value`. Detecting the
// dependency keeps the React Compiler `immutability` hint scoped to
// projects that can actually act on it. Checks the same four sections as
// the React Native gate so a reanimated dep in any section counts.
const REANIMATED_DEPENDENCY_NAME = "react-native-reanimated";

export const isPackageJsonReanimatedAware = (packageJson: PackageJson): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  };
  return Object.hasOwn(allDependencies, REANIMATED_DEPENDENCY_NAME);
};
