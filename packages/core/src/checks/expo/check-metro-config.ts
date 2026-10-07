import * as fs from "node:fs";
import * as path from "node:path";
import { isFile } from "../../project-info/index.js";
import { collectStaticModuleSpecifiers } from "../../project-analysis/utils/collect-static-module-specifiers.js";
import { isPathInsideDirectoryOrEqual } from "../../project-analysis/utils/is-path-inside-directory-or-equal.js";
import { resolveEntryWithExtensions } from "../../project-analysis/utils/resolve-entry-with-extensions.js";
import type { Diagnostic } from "../../types/index.js";
import { EXPO_METRO_CONFIG_MAX_MODULE_COUNT } from "./constants.js";
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
  "posthog-react-native/metro",
  "getPostHogExpoConfig",
];

const resolveLocalMetroConfigModule = (
  moduleSpecifier: string,
  importingFilePath: string,
  rootDirectory: string,
): string | undefined => {
  if (!moduleSpecifier.startsWith(".")) return undefined;

  const importedPath = path.resolve(path.dirname(importingFilePath), moduleSpecifier);
  const sourceImportedPath = importedPath.replace(/\.[cm]?js$/, "");
  const candidateBasePaths = [importedPath, sourceImportedPath, path.join(importedPath, "index")];
  for (const candidateBasePath of candidateBasePaths) {
    const resolvedPath = resolveEntryWithExtensions(candidateBasePath);
    if (
      resolvedPath !== undefined &&
      isFile(resolvedPath) &&
      isPathInsideDirectoryOrEqual(resolvedPath, rootDirectory)
    ) {
      return resolvedPath;
    }
  }
  return undefined;
};

const hasExpoMetroConfigSignal = (metroConfigPath: string, rootDirectory: string): boolean => {
  const pendingFilePaths = [metroConfigPath];
  const visitedFilePaths = new Set<string>();

  while (pendingFilePaths.length > 0) {
    const currentFilePath = pendingFilePaths.pop();
    if (currentFilePath === undefined || visitedFilePaths.has(currentFilePath)) continue;
    if (visitedFilePaths.size >= EXPO_METRO_CONFIG_MAX_MODULE_COUNT) return true;
    visitedFilePaths.add(currentFilePath);

    let contents: string;
    try {
      contents = fs.readFileSync(currentFilePath, "utf-8");
    } catch {
      return true;
    }
    if (EXPO_METRO_CONFIG_EXTEND_SIGNALS.some((signal) => contents.includes(signal))) return true;

    let moduleSpecifiers: Set<string>;
    try {
      moduleSpecifiers = collectStaticModuleSpecifiers(contents, {
        filePath: currentFilePath,
        includeTypeOnly: false,
      });
    } catch {
      continue;
    }
    for (const moduleSpecifier of moduleSpecifiers) {
      const localModulePath = resolveLocalMetroConfigModule(
        moduleSpecifier,
        currentFilePath,
        rootDirectory,
      );
      if (localModulePath !== undefined && !visitedFilePaths.has(localModulePath)) {
        pendingFilePaths.push(localModulePath);
      }
    }
  }

  return false;
};

export const checkExpoMetroConfig = (context: ExpoCheckContext): Diagnostic[] => {
  const metroConfigPath = METRO_CONFIG_FILE_NAMES.map((fileName) =>
    path.join(context.rootDirectory, fileName),
  ).find((candidatePath) => isFile(candidatePath));
  if (metroConfigPath === undefined) return [];

  if (hasExpoMetroConfigSignal(metroConfigPath, context.rootDirectory)) return [];

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
