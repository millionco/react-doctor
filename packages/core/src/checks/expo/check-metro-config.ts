import * as fs from "node:fs";
import * as path from "node:path";
import { isFile } from "../../project-info/index.js";
import type { Diagnostic } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";

// Expo projects must extend `expo/metro-config`; a custom metro.config that
// doesn't leads to hard-to-debug bundling issues. expo-doctor's
// `MetroConfigCheck` executes the config and diffs it against Expo's
// defaults — not possible in a static analyzer. This port applies the
// reliable subset: when a metro config file exists but references neither
// `expo/metro-config` nor a known wrapper that extends it, it cannot be
// extending Expo's config.
const METRO_CONFIG_FILE_NAMES: ReadonlyArray<string> = [
  "metro.config.js",
  "metro.config.cjs",
  "metro.config.mjs",
  "metro.config.ts",
];

// Substrings whose presence proves the config extends Expo's metro config.
// `expo/metro-config` is the canonical sub-export (and a substring of the
// `@expo/metro-config` package specifier, so both forms match). The
// remaining entries are well-known third-party wrappers that build their
// config on top of Expo's `getDefaultConfig` internally — e.g. Sentry's
// `getSentryExpoConfig` from `@sentry/react-native/metro`, the metro setup
// in Expo's own `with-sentry` template — so a config that only references
// the wrapper still extends Expo's and must not be flagged.
const EXPO_METRO_CONFIG_EXTEND_SIGNALS: ReadonlyArray<string> = [
  "expo/metro-config",
  "@sentry/react-native/metro",
  "getSentryExpoConfig",
];

export const checkExpoMetroConfig = (context: ExpoCheckContext): Diagnostic[] => {
  const metroConfigPath = METRO_CONFIG_FILE_NAMES.map((fileName) =>
    path.join(context.rootDirectory, fileName),
  ).find((candidatePath) => isFile(candidatePath));
  if (metroConfigPath === undefined) return [];

  let contents: string;
  try {
    contents = fs.readFileSync(metroConfigPath, "utf-8");
  } catch {
    return [];
  }
  if (EXPO_METRO_CONFIG_EXTEND_SIGNALS.some((signal) => contents.includes(signal))) return [];

  return [
    buildExpoDiagnostic({
      rule: "expo-metro-config",
      filePath: path.basename(metroConfigPath),
      message:
        "Your metro.config does not extend `expo/metro-config` — a custom Metro config that doesn't extend Expo's leads to unexpected, hard-to-debug bundling issues",
      help: "Update your metro config to extend `expo/metro-config`. See https://docs.expo.dev/guides/customizing-metro/",
    }),
  ];
};
