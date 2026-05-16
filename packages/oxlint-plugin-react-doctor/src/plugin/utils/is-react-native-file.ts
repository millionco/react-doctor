import { classifyPackagePlatform } from "./classify-package-platform.js";
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

// Returns true when react-native rules should be evaluated for `filename`
// given the surrounding `context.settings["react-doctor"].framework` hint.
//
// Decision order (the first matching row wins):
//
//   1. Filename ends with a native-only extension (`.ios.tsx`, `.android.tsx`,
//      `.native.tsx`) → ACTIVE. These files always target RN.
//   2. Filename ends with a web extension (`.web.tsx`) → INACTIVE.
//   3. Nearest package.json classifies as "web" → INACTIVE.
//   4. Nearest package.json classifies as "react-native" → ACTIVE.
//   5. Nearest package.json classifies as "unknown" → fall back to the
//      project-level framework setting:
//      • `react-native` or `expo` → ACTIVE
//      • any other known framework (`nextjs`, `vite`, `cra`, `remix`,
//        `gatsby`, `tanstack-start`) → INACTIVE
//      • `unknown` or missing → ACTIVE (conservatively keep the old
//        behavior so test fixtures and CLI invocations without a
//        discoverable framework still report RN issues; the project
//        capability gate in `runOxlint` already prevents RN rules from
//        loading at all unless the project is RN-aware).
//
// `context.getFilename()` may be unavailable in stripped-down test
// harnesses; in that case we keep RN rules active so the rule body can
// proceed.
export const isReactNativeFileActive = (context: RuleContext): boolean => {
  const filename = context.getFilename?.();
  if (!filename) return true;

  if (NATIVE_FILE_EXTENSION_PATTERN.test(filename)) return true;
  if (WEB_FILE_EXTENSION_PATTERN.test(filename)) return false;

  const packagePlatform = classifyPackagePlatform(filename);
  if (packagePlatform === "web") return false;
  if (packagePlatform === "react-native") return true;

  const framework = getReactDoctorStringSetting(context.settings, "framework");
  if (framework === "react-native" || framework === "expo") return true;
  if (
    framework === "nextjs" ||
    framework === "vite" ||
    framework === "cra" ||
    framework === "remix" ||
    framework === "gatsby" ||
    framework === "tanstack-start"
  ) {
    return false;
  }
  return true;
};
