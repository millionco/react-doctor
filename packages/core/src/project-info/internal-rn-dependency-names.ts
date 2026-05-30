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
