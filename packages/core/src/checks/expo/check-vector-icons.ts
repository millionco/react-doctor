import type { Diagnostic } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";
import { isExpoSdkAtLeast } from "./utils/is-expo-sdk-at-least.js";

// Ported from expo-doctor's `VectorIconsCheck` (sdkVersionRange `>=56`).
// Mixing the new scoped icon packages with `@expo/vector-icons` or the
// deprecated `react-native-vector-icons` leads to icon-rendering
// conflicts. expo-doctor resolves transitive deps; this static port keys
// off direct dependencies only.
const VECTOR_ICONS_MIN_SDK_MAJOR = 56;
const SCOPED_VECTOR_ICONS_NAMESPACE = "@react-native-vector-icons/";
const CONFLICTING_VECTOR_ICONS_PACKAGES: ReadonlyArray<string> = [
  "@expo/vector-icons",
  "react-native-vector-icons",
];

export const checkExpoVectorIcons = (context: ExpoCheckContext): Diagnostic[] => {
  if (!isExpoSdkAtLeast(context.expoSdkMajor, VECTOR_ICONS_MIN_SDK_MAJOR)) return [];

  const hasScopedPackage = [...context.directDependencyNames].some((packageName) =>
    packageName.startsWith(SCOPED_VECTOR_ICONS_NAMESPACE),
  );
  const hasConflictingPackage = CONFLICTING_VECTOR_ICONS_PACKAGES.some((packageName) =>
    context.directDependencyNames.has(packageName),
  );
  if (!hasScopedPackage || !hasConflictingPackage) return [];

  return [
    buildExpoDiagnostic({
      rule: "expo-vector-icons-conflict",
      message:
        "This project installs both the scoped `@react-native-vector-icons/*` packages and `@expo/vector-icons` (or the deprecated `react-native-vector-icons`) — mixing them causes icon-rendering conflicts",
      help: "Migrate to the scoped packages by running `npx @react-native-vector-icons/codemod`, then remove the conflicting package",
    }),
  ];
};
