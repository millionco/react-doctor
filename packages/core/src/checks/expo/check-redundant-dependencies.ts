import path from "node:path";
import { readPackageJson } from "../../project-info/index.js";
import type { Diagnostic } from "../../types/index.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";
import { getDirectDependencyNames } from "./utils/get-direct-dependency-names.js";
import { getExpoSdkMajor } from "./utils/get-expo-sdk-major.js";

interface RedundantDependency {
  readonly packageName: string;
  readonly message: string;
  readonly help: string;
  /**
   * Lowest Expo SDK major the finding applies to. When set, the check
   * stays quiet unless the resolved SDK major is known AND at least this
   * value — so a package that is only redundant from a later SDK never
   * false-positives on an older project (or one whose SDK can't be
   * resolved). Omit for findings that hold on every SDK.
   */
  readonly minSdkMajor?: number;
}

// Ported from expo-doctor's `DirectPackageInstallCheck`: packages that are
// transitive dependencies of `expo` (or were removed/deprecated) and
// should not be listed directly in a project's manifest.
const REDUNDANT_DEPENDENCIES: ReadonlyArray<RedundantDependency> = [
  {
    packageName: "expo-modules-autolinking",
    message:
      '"expo-modules-autolinking" should not be a direct dependency — Expo installs it transitively as needed',
    help: "Remove `expo-modules-autolinking` from your package.json",
  },
  {
    packageName: "expo-dev-launcher",
    message:
      '"expo-dev-launcher" should not be a direct dependency — it is pulled in by `expo-dev-client`',
    help: "Remove `expo-dev-launcher` and depend on `expo-dev-client` instead",
  },
  {
    packageName: "expo-dev-menu",
    message:
      '"expo-dev-menu" should not be a direct dependency — it is pulled in by `expo-dev-client`',
    help: "Remove `expo-dev-menu` and depend on `expo-dev-client` instead",
  },
  {
    packageName: "expo-modules-core",
    message:
      '"expo-modules-core" should not be a direct dependency — use the API re-exported from the `expo` package',
    help: "Remove `expo-modules-core` from your package.json and import from `expo` instead",
  },
  {
    packageName: "@expo/metro-config",
    message:
      '"@expo/metro-config" should not be a direct dependency — use the `expo/metro-config` sub-export of the `expo` package',
    help: "Remove `@expo/metro-config` and import `expo/metro-config` in your metro.config.js",
  },
  {
    packageName: "@types/react-native",
    message:
      '"@types/react-native" should not be installed — React Native ships its own types since SDK 48',
    help: "Remove `@types/react-native` from your package.json",
    minSdkMajor: 48,
  },
  {
    packageName: "@expo/config-plugins",
    message:
      '"@expo/config-plugins" should not be a direct dependency — use the `expo/config-plugins` sub-export of the `expo` package',
    help: "Remove `@expo/config-plugins`; config-plugin authors should import from `expo/config-plugins`. See https://github.com/expo/expo/pull/18855",
    minSdkMajor: 48,
  },
  {
    packageName: "@expo/prebuild-config",
    message:
      '"@expo/prebuild-config" should not be a direct dependency — Expo installs it transitively',
    help: "Remove `@expo/prebuild-config` from your package.json",
    minSdkMajor: 53,
  },
  {
    packageName: "expo-permissions",
    message:
      '"expo-permissions" was deprecated in SDK 41 and may no longer compile — permissions moved onto each module (e.g. `MediaLibrary.requestPermissionsAsync()`)',
    help: "Remove `expo-permissions` and request permissions from the relevant module instead",
    minSdkMajor: 50,
  },
  {
    packageName: "expo-app-loading",
    message: '"expo-app-loading" was removed in SDK 49',
    help: "Remove `expo-app-loading` and use `expo-splash-screen` instead. See https://docs.expo.dev/versions/latest/sdk/splash-screen/",
    minSdkMajor: 49,
  },
  {
    packageName: "expo-firebase-analytics",
    message: '"expo-firebase-analytics" was removed in SDK 48',
    help: "Use the Firebase JS SDK or React Native Firebase directly. See https://expo.fyi/firebase-migration-guide",
    minSdkMajor: 48,
  },
  {
    packageName: "expo-firebase-recaptcha",
    message: '"expo-firebase-recaptcha" was removed in SDK 48',
    help: "Use the Firebase JS SDK or React Native Firebase directly. See https://expo.fyi/firebase-migration-guide",
    minSdkMajor: 48,
  },
  {
    packageName: "expo-firebase-core",
    message: '"expo-firebase-core" was removed in SDK 48',
    help: "Use the Firebase JS SDK or React Native Firebase directly. See https://expo.fyi/firebase-migration-guide",
    minSdkMajor: 48,
  },
];

export const checkExpoRedundantDependencies = (rootDirectory: string): Diagnostic[] => {
  const packageJson = readPackageJson(path.join(rootDirectory, "package.json"));
  const directDependencyNames = getDirectDependencyNames(packageJson);
  const expoSdkMajor = getExpoSdkMajor(packageJson);

  return REDUNDANT_DEPENDENCIES.filter((redundantDependency) => {
    if (!directDependencyNames.has(redundantDependency.packageName)) return false;
    if (redundantDependency.minSdkMajor === undefined) return true;
    return expoSdkMajor !== null && expoSdkMajor >= redundantDependency.minSdkMajor;
  }).map((redundantDependency) =>
    buildExpoDiagnostic({
      rule: "expo-no-redundant-dependency",
      message: redundantDependency.message,
      help: redundantDependency.help,
    }),
  );
};
