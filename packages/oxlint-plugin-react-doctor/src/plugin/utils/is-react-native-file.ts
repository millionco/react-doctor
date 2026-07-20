import {
  classifyPackagePlatform,
  findNearestPackageDirectory,
} from "./classify-package-platform.js";
import { isPackageWithinProjectRoot } from "./is-package-within-project-root.js";
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
      isPackageWithinProjectRoot(packageDirectory, rootDirectory, false)
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
