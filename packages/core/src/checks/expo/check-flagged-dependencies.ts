import type { Diagnostic } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";
import { isExpoSdkAtLeast } from "./utils/is-expo-sdk-at-least.js";

interface FlaggedDependency {
  readonly packageName: string;
  readonly rule: string;
  readonly message: string;
  readonly help: string;
  /**
   * Lowest Expo SDK major the finding applies to. When set, the entry
   * stays quiet unless the resolved SDK major is known AND at least this
   * value — so a package that only became redundant in a later SDK never
   * false-positives on an older project (or one whose SDK can't be
   * resolved). Omit for findings that hold on every SDK.
   */
  readonly minSdkMajor?: number;
}

const UNIMODULES_HELP =
  "Remove every `@unimodules/*` and `react-native-unimodules` package — their functionality now lives in `expo-modules-core`. See https://expo.fyi/r/sdk-44-remove-unimodules";

const FIREBASE_HELP =
  "Use the Firebase JS SDK or React Native Firebase directly. See https://expo.fyi/firebase-migration-guide";

const unimodulesEntry = (packageName: string): FlaggedDependency => ({
  packageName,
  rule: "expo-no-unimodules-packages",
  message: `"${packageName}" is a legacy unimodules package that is incompatible with Expo SDK 44+ and will break native builds`,
  help: UNIMODULES_HELP,
});

// Direct dependencies a project should not declare. All three originating
// expo-doctor checks (IllegalPackageCheck, GlobalPackageInstalledLocallyCheck,
// DirectPackageInstallCheck) perform the same detection — "is this package a
// direct dependency? (optionally gated on the SDK major) → warn" — so they
// share one table and one pass. The per-entry `rule` preserves the
// user-facing distinction between the three families.
const FLAGGED_DEPENDENCIES: ReadonlyArray<FlaggedDependency> = [
  // Legacy unimodules packages (IllegalPackageCheck).
  unimodulesEntry("@unimodules/core"),
  unimodulesEntry("@unimodules/react-native-adapter"),
  unimodulesEntry("react-native-unimodules"),

  // CLIs that should not be project dependencies (GlobalPackageInstalledLocallyCheck).
  {
    packageName: "expo-cli",
    rule: "expo-no-cli-dependencies",
    message:
      "`expo-cli` (the legacy global CLI) is a project dependency — the CLI now ships inside the `expo` package, and keeping `expo-cli` causes failures such as `unknown option --fix` when running `npx expo install --fix`",
    help: "Remove `expo-cli` from your dependencies and use the bundled CLI via `npx expo`",
  },
  {
    packageName: "eas-cli",
    rule: "expo-no-cli-dependencies",
    message:
      "`eas-cli` is a project dependency — pinning it in package.json drifts from the latest EAS CLI and bloats installs",
    help: "Remove `eas-cli` from your dependencies and run it on demand with `npx eas-cli` (or install it globally)",
  },

  // Packages Expo installs transitively, or that were removed/deprecated
  // (DirectPackageInstallCheck).
  {
    packageName: "expo-modules-autolinking",
    rule: "expo-no-redundant-dependency",
    message:
      '"expo-modules-autolinking" should not be a direct dependency. Expo pins the compatible version through the SDK, and a direct entry can drift to a version that breaks prebuild, Metro, or native builds',
    help: "Remove `expo-modules-autolinking` from your package.json",
  },
  {
    packageName: "expo-dev-launcher",
    rule: "expo-no-redundant-dependency",
    message:
      '"expo-dev-launcher" should not be a direct dependency. `expo-dev-client` pins the compatible launcher, and a direct entry can drift to a version that breaks native builds',
    help: "Remove `expo-dev-launcher` and depend on `expo-dev-client` instead",
  },
  {
    packageName: "expo-dev-menu",
    rule: "expo-no-redundant-dependency",
    message:
      '"expo-dev-menu" should not be a direct dependency. `expo-dev-client` pins the compatible dev menu, and a direct entry can drift to a version that breaks native builds',
    help: "Remove `expo-dev-menu` and depend on `expo-dev-client` instead",
  },
  {
    packageName: "expo-modules-core",
    rule: "expo-no-redundant-dependency",
    message:
      '"expo-modules-core" should not be a direct dependency. Expo pins the compatible native core, and a direct entry can drift to a version that breaks prebuild or native builds',
    help: "Remove `expo-modules-core` from your package.json and import from `expo` instead",
  },
  {
    packageName: "@expo/metro-config",
    rule: "expo-no-redundant-dependency",
    message:
      '"@expo/metro-config" should not be a direct dependency. Expo pins the compatible Metro config, and a direct entry can drift to a version that breaks bundling',
    help: "Remove `@expo/metro-config` and import `expo/metro-config` in your metro.config.js",
  },
  {
    packageName: "@types/react-native",
    rule: "expo-no-redundant-dependency",
    message:
      '"@types/react-native" should not be installed. React Native ships its own types since SDK 48, so the extra package can introduce duplicate or stale type definitions',
    help: "Remove `@types/react-native` from your package.json",
    minSdkMajor: 48,
  },
  {
    packageName: "@expo/config-plugins",
    rule: "expo-no-redundant-dependency",
    message:
      '"@expo/config-plugins" should not be a direct dependency. Expo pins the compatible config-plugin API, and a direct entry can drift to a version that breaks prebuild',
    help: "Remove `@expo/config-plugins`; config-plugin authors should import from `expo/config-plugins`. See https://github.com/expo/expo/pull/18855",
    minSdkMajor: 48,
  },
  {
    packageName: "@expo/prebuild-config",
    rule: "expo-no-redundant-dependency",
    message:
      '"@expo/prebuild-config" should not be a direct dependency. Expo pins the compatible prebuild config, and a direct entry can drift to a version that breaks prebuild',
    help: "Remove `@expo/prebuild-config` from your package.json",
    minSdkMajor: 53,
  },
  {
    packageName: "expo-permissions",
    rule: "expo-no-redundant-dependency",
    message:
      '"expo-permissions" was deprecated in SDK 41 and may no longer compile — permissions moved onto each module (e.g. `MediaLibrary.requestPermissionsAsync()`)',
    help: "Remove `expo-permissions` and request permissions from the relevant module instead",
    minSdkMajor: 50,
  },
  {
    packageName: "expo-app-loading",
    rule: "expo-no-redundant-dependency",
    message:
      '"expo-app-loading" was removed in SDK 49, so keeping it can leave imports unresolved after upgrading Expo',
    help: "Remove `expo-app-loading` and use `expo-splash-screen` instead. See https://docs.expo.dev/versions/latest/sdk/splash-screen/",
    minSdkMajor: 49,
  },
  {
    packageName: "expo-firebase-analytics",
    rule: "expo-no-redundant-dependency",
    message:
      '"expo-firebase-analytics" was removed in SDK 48, so keeping it can leave imports unresolved or fail native builds after upgrading Expo',
    help: FIREBASE_HELP,
    minSdkMajor: 48,
  },
  {
    packageName: "expo-firebase-recaptcha",
    rule: "expo-no-redundant-dependency",
    message:
      '"expo-firebase-recaptcha" was removed in SDK 48, so keeping it can leave imports unresolved or fail native builds after upgrading Expo',
    help: FIREBASE_HELP,
    minSdkMajor: 48,
  },
  {
    packageName: "expo-firebase-core",
    rule: "expo-no-redundant-dependency",
    message:
      '"expo-firebase-core" was removed in SDK 48, so keeping it can leave imports unresolved or fail native builds after upgrading Expo',
    help: FIREBASE_HELP,
    minSdkMajor: 48,
  },
];

export const checkExpoFlaggedDependencies = (context: ExpoCheckContext): Diagnostic[] =>
  FLAGGED_DEPENDENCIES.filter((flaggedDependency) => {
    if (!context.directDependencyNames.has(flaggedDependency.packageName)) return false;
    if (flaggedDependency.minSdkMajor === undefined) return true;
    return isExpoSdkAtLeast(context.expoSdkMajor, flaggedDependency.minSdkMajor);
  }).map((flaggedDependency) =>
    buildExpoDiagnostic({
      rule: flaggedDependency.rule,
      message: flaggedDependency.message,
      help: flaggedDependency.help,
    }),
  );
