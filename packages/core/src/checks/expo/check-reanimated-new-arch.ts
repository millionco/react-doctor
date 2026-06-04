import { getLowestDependencyMajor } from "../../project-info/utils/dependency-version-spec.js";
import type { Diagnostic } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";
import { readExpoAppConfig } from "./utils/read-expo-app-config.js";

const REANIMATED_PACKAGE = "react-native-reanimated";
const WORKLETS_PACKAGE = "react-native-worklets";
const FIRST_NEW_ARCH_ONLY_REANIMATED_MAJOR = 4;

// Reanimated 4 dropped support for the legacy architecture — it runs only
// on the New Architecture and hard-crashes on first launch otherwise. Expo
// projects opt out of the New Arch with `expo.newArchEnabled: false` in the
// app config, so that combination is a guaranteed startup crash. We treat
// `react-native-worklets` (Reanimated 4's split-out worklet runtime) as an
// equivalent v4 signal. Only a statically-readable `newArchEnabled: false` in a
// JSON app config with NO dynamic `app.config.{js,ts}` present trips this — a
// dynamic config can override the flag and we can't evaluate it offline, so its
// presence makes this a documented false-negative (see `readExpoAppConfig`).
export const checkExpoReanimatedNewArch = (context: ExpoCheckContext): Diagnostic[] => {
  const reanimatedSpec =
    context.packageJson.dependencies?.[REANIMATED_PACKAGE] ??
    context.packageJson.devDependencies?.[REANIMATED_PACKAGE];
  const reanimatedMajor =
    reanimatedSpec === undefined ? null : getLowestDependencyMajor(reanimatedSpec);
  const isReanimatedV4Plus =
    (reanimatedMajor !== null && reanimatedMajor >= FIRST_NEW_ARCH_ONLY_REANIMATED_MAJOR) ||
    context.directDependencyNames.has(WORKLETS_PACKAGE);
  if (!isReanimatedV4Plus) return [];

  const appConfig = readExpoAppConfig(context.rootDirectory);
  if (appConfig.config?.newArchEnabled !== false) return [];

  return [
    buildExpoDiagnostic({
      rule: "expo-reanimated-v4-requires-new-arch",
      // A guaranteed first-launch crash — surface by default, not behind --warnings.
      severity: "error",
      filePath: appConfig.configFile ?? "app.json",
      message:
        "react-native-reanimated v4 supports only the New Architecture, but `newArchEnabled: false` is set in your app config, so the app will crash on first launch.",
      help: "Remove `newArchEnabled: false` from your app config (the New Architecture is the default on SDK 52+), or pin react-native-reanimated to v3 if you must stay on the legacy architecture.",
    }),
  ];
};
