import * as fs from "node:fs";
import {
  classifyPackagePlatform,
  findNearestPackageDirectory,
} from "./classify-package-platform.js";
import { normalizeFilename } from "./normalize-filename.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import type { RuleContext } from "./rule-context.js";

// File extensions whose presence in the filename means "force this file
// onto the web target, regardless of what the surrounding package
// declares". React Native's Metro bundler resolves `*.web.tsx` /
// `*.web.jsx` (and the `.js` / `.ts` variants) preferentially when
// targeting `react-native-web`, so any file ending in these extensions
// is web-by-construction.
const WEB_FILE_EXTENSION_PATTERN = /\.web\.[cm]?[jt]sx?$/;

// Native-only extensions that pin a file to mobile RN regardless of
// the project framework — used in mixed RN-web monorepos to opt files
// back into RN-only checks even when the package classification (or
// project framework) doesn't already cover them.
const NATIVE_FILE_EXTENSION_PATTERN = /\.(?:ios|android|native)\.[cm]?[jt]sx?$/;

// Symlink-tolerant directory comparison: core realpaths the settings
// `rootDirectory` (see `resolveSettingsRootDirectory`), while oxlint may
// hand rules pre-realpath filenames (macOS `/var` vs `/private/var`), so
// the package directory is realpathed too before comparing. Memoized per
// package directory — every file in a package shares the answer.
const cachedRealDirectoryByDirectory = new Map<string, string>();

const resolveRealDirectory = (directory: string): string => {
  const cached = cachedRealDirectoryByDirectory.get(directory);
  if (cached !== undefined) return cached;
  let realDirectory: string;
  try {
    realDirectory = fs.realpathSync(directory);
  } catch {
    realDirectory = directory;
  }
  cachedRealDirectoryByDirectory.set(directory, realDirectory);
  return realDirectory;
};

// A "neutral" package (a parseable manifest that declares dependencies but
// no RN and no web-framework signal) is authoritative when it sits BELOW
// the project root: in a monorepo, the RN capability comes from a sibling
// workspace, and this package's own manifest says it never depends on
// react-native — so RN rules must not apply to its files. At the project
// root the manifest is the same one the project-level framework hint was
// derived from, so the framework fallback stays in charge.
const isPackageNestedBelowProjectRoot = (
  packageDirectory: string,
  rootDirectory: string | undefined,
): boolean => {
  if (rootDirectory === undefined || rootDirectory.length === 0) return false;
  const realPackageDirectory = normalizeFilename(resolveRealDirectory(packageDirectory));
  const normalizedRootDirectory = normalizeFilename(rootDirectory);
  const rootPrefix = normalizedRootDirectory.endsWith("/")
    ? normalizedRootDirectory
    : `${normalizedRootDirectory}/`;
  return realPackageDirectory.startsWith(rootPrefix);
};

// Classifies which platform `filename` targets given the surrounding
// `context.settings["react-doctor"].framework` hint. `isReactNativeFileActive`
// (whether RN rules should run) treats "unknown" as active; callers that only
// branch on wording should treat "unknown" as web.
//
// Decision order (the first matching row wins):
//
//   1. Filename ends with a native-only extension (`.ios.tsx`, `.android.tsx`,
//      `.native.tsx`) → "react-native". These files always target RN.
//   2. Filename ends with a web extension (`.web.tsx`) → "web".
//   3. Nearest package.json classifies as "web" → "web".
//   4. Nearest package.json classifies as "expo" or "react-native" → "react-native".
//   5. Nearest package.json classifies as "neutral" (declares dependencies,
//      none of them RN or a web framework) AND sits below the project root
//      (a nested workspace package) → "web". The package's own manifest is
//      the authority: a monorepo package that never depends on react-native
//      must not get RN rules just because a sibling workspace does.
//   6. Nearest package.json classifies as "unknown" (or "neutral" at the
//      project root itself) → fall back to the project-level framework
//      setting:
//      • `react-native` or `expo` → "react-native"
//      • any other known framework (`nextjs`, `vite`, `cra`, `remix`,
//        `gatsby`, `tanstack-start`) → "web"
//      • `unknown` or missing → "unknown" (`isReactNativeFileActive`
//        conservatively keeps RN rules active here so test fixtures and
//        CLI invocations without a discoverable framework still report
//        RN issues; the project capability gate in `runOxlint` already
//        prevents RN rules from loading at all unless the project is
//        RN-aware).
//
// `context.filename` may be unavailable in stripped-down test
// harnesses; in that case the target is "unknown" and RN rules stay
// active so the rule body can proceed.
export type ReactNativeFileTarget = "react-native" | "web" | "unknown";

export const classifyReactNativeFileTarget = (context: RuleContext): ReactNativeFileTarget => {
  const rawFilename = context.filename;
  if (!rawFilename) return "unknown";
  const filename = normalizeFilename(rawFilename);

  if (NATIVE_FILE_EXTENSION_PATTERN.test(filename)) return "react-native";
  if (WEB_FILE_EXTENSION_PATTERN.test(filename)) return "web";

  const packagePlatform = classifyPackagePlatform(filename);
  if (packagePlatform === "web") return "web";
  if (packagePlatform === "expo" || packagePlatform === "react-native") return "react-native";
  if (packagePlatform === "neutral") {
    const packageDirectory = findNearestPackageDirectory(filename);
    const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
    if (
      packageDirectory !== null &&
      isPackageNestedBelowProjectRoot(packageDirectory, rootDirectory)
    ) {
      return "web";
    }
  }

  const framework = getReactDoctorStringSetting(context.settings, "framework");
  if (framework === "react-native" || framework === "expo") return "react-native";
  if (
    framework === "nextjs" ||
    framework === "vite" ||
    framework === "cra" ||
    framework === "remix" ||
    framework === "gatsby" ||
    framework === "tanstack-start"
  ) {
    return "web";
  }
  return "unknown";
};

export const isReactNativeFileActive = (context: RuleContext): boolean =>
  classifyReactNativeFileTarget(context) !== "web";
