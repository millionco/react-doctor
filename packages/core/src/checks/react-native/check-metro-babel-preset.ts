import * as fs from "node:fs";
import * as path from "node:path";
import { isFile } from "../../project-info/index.js";
import type { Diagnostic } from "../../types/index.js";
import { buildReactNativeDiagnostic } from "./utils/build-react-native-diagnostic.js";

// The babel config files we inspect. A project has a single root babel config,
// so we report the first file that trips either babel-preset check.
const BABEL_CONFIG_FILE_NAMES: ReadonlyArray<string> = [
  "babel.config.js",
  "babel.config.cjs",
  "babel.config.mjs",
  "babel.config.json",
  ".babelrc",
  ".babelrc.js",
  ".babelrc.json",
];

// We match the `module:`-prefixed preset spec, not the bare package name:
// real configs always reference it as `module:metro-react-native-babel-preset`,
// and matching the prefixed form avoids the false positive where a config
// merely *mentions* the package in a comment (observed in the OSS corpus).
const LEGACY_PRESET_SPEC = "module:metro-react-native-babel-preset";

const MODERN_PRESET_SPEC = "module:@react-native/babel-preset";

// The modern spec is also its own `module:`-prefixed string, so unlike the
// legacy package name it still appears verbatim in comments. Require it inside
// a string literal (quoted) so a migration comment in an Expo config doesn't
// trip the runtime-version check.
const MODERN_PRESET_REFERENCE = new RegExp(`['"]${MODERN_PRESET_SPEC}['"]`);

// `enableBabelRuntime` only fixes the bundle bloat when it carries a version
// string — `enableBabelRuntime: true` / `false` (and a bare mention in a
// comment) all leave the runtime version pinned to its 7.0.0 default, so we
// require the option to be assigned a quoted version. The optional quote after
// the key matches JSON configs (`"enableBabelRuntime": "^7.26.0"`) as well as
// JS object keys (`enableBabelRuntime: '^7.26.0'`).
const ENABLE_BABEL_RUNTIME_VERSION = /enableBabelRuntime["']?\s*:\s*['"]/;

// Two babel-preset footguns surface here:
//   1. `rn-no-metro-babel-preset` (error) — `module:metro-react-native-babel-preset`
//      was renamed to `@react-native/babel-preset` and is no longer installed by
//      React Native >= 0.73, so the stale preset reference fails to resolve and
//      hard-breaks the Metro/Babel transform after an upgrade.
//   2. `rn-no-metro-babel-runtime-version` (warning) — `@react-native/babel-preset`
//      without an `enableBabelRuntime` version can duplicate Babel runtime helpers
//      across files instead of importing them once from @babel/runtime, inflating
//      the JS bundle (https://github.com/facebook/react-native/issues/57123).
export const checkReactNativeMetroBabelPreset = (rootDirectory: string): Diagnostic[] => {
  for (const fileName of BABEL_CONFIG_FILE_NAMES) {
    const filePath = path.join(rootDirectory, fileName);
    if (!isFile(filePath)) continue;
    let contents: string;
    try {
      contents = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }
    if (contents.includes(LEGACY_PRESET_SPEC)) {
      return [
        buildReactNativeDiagnostic({
          filePath: fileName,
          rule: "rn-no-metro-babel-preset",
          // Hard-fails the Metro/Babel transform on RN 0.73+ — surface by
          // default, not behind --warnings.
          severity: "error",
          message:
            "`module:metro-react-native-babel-preset` was renamed to `@react-native/babel-preset` and is no longer installed by React Native 0.73+ — this preset reference fails to resolve and breaks the Metro/Babel transform.",
          help: "Replace the preset with `module:@react-native/babel-preset` (or `babel-preset-expo` on Expo) and remove the old `metro-react-native-babel-preset` dependency.",
        }),
      ];
    }
    if (MODERN_PRESET_REFERENCE.test(contents) && !ENABLE_BABEL_RUNTIME_VERSION.test(contents)) {
      return [
        buildReactNativeDiagnostic({
          filePath: fileName,
          rule: "rn-no-metro-babel-runtime-version",
          // A bundle-size optimization, not a broken build — keep it advisory so
          // it never blocks CI on the default React Native babel config.
          severity: "warning",
          message:
            "`module:@react-native/babel-preset` has no `enableBabelRuntime` version, so Babel runtime helpers can be duplicated across files instead of imported once from @babel/runtime, increasing the JS bundle size.",
          help: "Set `enableBabelRuntime` to the @babel/runtime version from package.json, e.g. `['module:@react-native/babel-preset', { enableBabelRuntime: '^7.26.0' }]`.",
        }),
      ];
    }
  }
  return [];
};
