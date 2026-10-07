import type { Diagnostic } from "../../types/index.js";
import { buildReactNativeDiagnostic } from "./utils/build-react-native-diagnostic.js";
import { readAndroidReleaseShrinking } from "./utils/read-android-release-shrinking.js";

export const checkReactNativeAndroidReleaseShrinking = (rootDirectory: string): Diagnostic[] => {
  const releaseShrinking = readAndroidReleaseShrinking(rootDirectory);
  if (releaseShrinking === null) return [];

  const disabledFeatures = [
    releaseShrinking.hasDisabledMinification ? "code minification" : null,
    releaseShrinking.hasDisabledResourceShrinking ? "resource shrinking" : null,
  ].filter((feature): feature is string => feature !== null);
  return [
    buildReactNativeDiagnostic({
      filePath: releaseShrinking.filePath,
      rule: "rn-android-release-shrinking-disabled",
      category: "Performance",
      message: `The Android release build explicitly disables ${disabledFeatures.join(" and ")}, leaving unreachable code or resources in the shipped app.`,
      help: "Enable release code minification and resource shrinking, then test the optimized build and add keep rules for libraries that require them.",
    }),
  ];
};
