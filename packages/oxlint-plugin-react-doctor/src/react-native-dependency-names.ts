// Canonical RN-aware-manifest detection rules. Co-located with the rule
// gate (`classify-package-platform.ts`) that is the only direct consumer.
// A short-lived twin list lives at
// `core/src/project-info/internal-rn-dependency-names.ts` (see #440) so
// the project-discovery gate can stay independent of this plugin.
//
// `react-native-web` is intentionally NOT included — it's a DOM compat
// layer that pairs with `react-dom` / Next / Vite hosts, not a mobile
// target.

// Closed set of canonical Expo-managed dependency names.
export const EXPO_MANAGED_DEPENDENCY_NAMES: ReadonlySet<string> = new Set([
  "expo",
  "expo-router",
  "@expo/cli",
  "@expo/metro-config",
  "@expo/metro-runtime",
]);

// Closed set of canonical RN/Expo dependency names.
export const REACT_NATIVE_DEPENDENCY_NAMES: ReadonlySet<string> = new Set([
  "react-native",
  "react-native-tvos",
  ...EXPO_MANAGED_DEPENDENCY_NAMES,
  "react-native-windows",
  "react-native-macos",
]);

// Scoped namespaces whose member packages are RN-only by construction —
// `@react-native/babel-preset`, `@react-native-firebase/app`,
// `@react-native-community/cli`, `@react-native-async-storage/async-storage`,
// and the dozens of other community packages. Prefix-matched so new
// publishes never require a code change.
export const REACT_NATIVE_DEPENDENCY_PREFIXES: ReadonlyArray<string> = [
  "@react-native/",
  "@react-native-",
];

export const isExpoManagedDependencyName = (dependencyName: string): boolean =>
  EXPO_MANAGED_DEPENDENCY_NAMES.has(dependencyName);

// True when `dependencyName` is either a known RN/Expo package or sits
// inside one of the `@react-native/` / `@react-native-` namespaces.
export const isReactNativeDependencyName = (dependencyName: string): boolean => {
  if (REACT_NATIVE_DEPENDENCY_NAMES.has(dependencyName)) return true;
  for (const prefix of REACT_NATIVE_DEPENDENCY_PREFIXES) {
    if (dependencyName.startsWith(prefix)) return true;
  }
  return false;
};
