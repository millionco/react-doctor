import type { Diagnostic } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";
import { readExpoAppConfig } from "./utils/read-expo-app-config.js";

// `expo.updates.disableAntiBrickingMeasures: true` turns off the safeguards
// that let expo-updates recover from a bad update; the Expo docs state it
// "is liable to leave an app in a bricked state" and must not be used in
// production. We only flag the statically-readable `true` in a JSON app config
// with NO dynamic `app.config.{js,ts}` present — a dynamic config can override
// the flag and we can't evaluate it offline, so its presence makes this a
// documented false-negative (see `readExpoAppConfig`).
export const checkExpoUpdatesConfig = (context: ExpoCheckContext): Diagnostic[] => {
  const appConfig = readExpoAppConfig(context.rootDirectory);
  if (appConfig.config?.updates?.disableAntiBrickingMeasures !== true) return [];

  return [
    buildExpoDiagnostic({
      rule: "expo-updates-no-unsafe-production-config",
      // Can permanently brick installed apps — surface by default, not behind --warnings.
      severity: "error",
      filePath: appConfig.configFile ?? "app.json",
      message:
        "`updates.disableAntiBrickingMeasures: true` disables expo-updates' recovery safeguards and is liable to leave installed apps in a permanently bricked state, so it must not be used in production.",
      help: "Remove `disableAntiBrickingMeasures` from your app config's `updates` block. See https://docs.expo.dev/versions/latest/config/app/#updates",
    }),
  ];
};
