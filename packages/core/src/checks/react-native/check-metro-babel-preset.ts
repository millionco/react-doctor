import * as fs from "node:fs";
import * as path from "node:path";
import { isFile } from "../../project-info/index.js";
import type { Diagnostic } from "../../types/index.js";

// The babel config files we inspect. Order doesn't matter — we flag the
// first one that still references the renamed preset.
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

// `metro-react-native-babel-preset` was renamed to `@react-native/babel-preset`
// and is no longer installed by React Native >= 0.73, so a config that still
// references the old preset spec fails to resolve and hard-breaks the
// Metro/Babel transform after an upgrade.
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
    if (!contents.includes(LEGACY_PRESET_SPEC)) continue;

    return [
      {
        filePath: fileName,
        plugin: "react-doctor",
        rule: "rn-no-metro-babel-preset",
        // Hard-fails the Metro/Babel transform on RN 0.73+ — surface by
        // default, not behind --warnings.
        severity: "error",
        message:
          "`module:metro-react-native-babel-preset` was renamed to `@react-native/babel-preset` and is no longer installed by React Native 0.73+ — this preset reference fails to resolve and breaks the Metro/Babel transform.",
        help: "Replace the preset with `module:@react-native/babel-preset` (or `babel-preset-expo` on Expo) and remove the old `metro-react-native-babel-preset` dependency.",
        line: 0,
        column: 0,
        category: "Correctness",
      },
    ];
  }
  return [];
};
