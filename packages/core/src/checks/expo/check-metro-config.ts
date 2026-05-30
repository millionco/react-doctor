import fs from "node:fs";
import path from "node:path";
import { isFile } from "../../project-info/index.js";
import type { Diagnostic } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";

// Expo projects must extend `expo/metro-config`; a custom metro.config that
// doesn't leads to hard-to-debug bundling issues. expo-doctor's
// `MetroConfigCheck` executes the config and diffs it against Expo's
// defaults — not possible in a static analyzer. This port applies the
// reliable subset: when a metro config file exists but never references
// `expo/metro-config` at all, it cannot be extending it.
const METRO_CONFIG_FILE_NAMES: ReadonlyArray<string> = [
  "metro.config.js",
  "metro.config.cjs",
  "metro.config.mjs",
  "metro.config.ts",
];

const EXPO_METRO_CONFIG_REFERENCE = "expo/metro-config";

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
  if (contents.includes(EXPO_METRO_CONFIG_REFERENCE)) return [];

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
