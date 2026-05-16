// Canonical RN-aware-manifest detection rules. Lives in `@react-doctor/types`
// — even though this package is otherwise type-only — so the two layers
// that need to agree about "what counts as React Native" can share a
// single source instead of duplicating the lists:
//
//   - `oxlint-plugin-react-doctor` / `classify-package-platform.ts`
//     (file-level rule gate; decides whether each file's nearest
//     `package.json` is RN-aware).
//   - `@react-doctor/project-info` / `is-package-json-react-native-aware.ts`
//     (project-level capability gate; decides whether any `rn-*` rule
//     loads at all on a web-rooted monorepo with an RN workspace).
//
// `react-native-web` is intentionally NOT included — it's a DOM compat
// layer that pairs with `react-dom` / Next / Vite hosts, not a mobile
// target.

// Closed set of canonical RN/Expo dependency names.
export const REACT_NATIVE_DEPENDENCY_NAMES: ReadonlySet<string> = new Set([
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

// Scoped namespaces whose member packages are RN-only by construction —
// `@react-native/babel-preset`, `@react-native-firebase/app`,
// `@react-native-community/cli`, `@react-native-async-storage/async-storage`,
// and the dozens of other community packages. Prefix-matched so new
// publishes never require a code change.
export const REACT_NATIVE_DEPENDENCY_PREFIXES: ReadonlyArray<string> = [
  "@react-native/",
  "@react-native-",
];

// True when `dependencyName` is either a known RN/Expo package or sits
// inside one of the `@react-native/` / `@react-native-` namespaces.
export const isReactNativeDependencyName = (dependencyName: string): boolean => {
  if (REACT_NATIVE_DEPENDENCY_NAMES.has(dependencyName)) return true;
  for (const prefix of REACT_NATIVE_DEPENDENCY_PREFIXES) {
    if (dependencyName.startsWith(prefix)) return true;
  }
  return false;
};
