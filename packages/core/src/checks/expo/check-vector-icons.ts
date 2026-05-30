import path from "node:path";
import { readPackageJson } from "../../project-info/index.js";
import type { Diagnostic } from "../../types/index.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";
import { getDirectDependencyNames } from "./utils/get-direct-dependency-names.js";
import { getExpoSdkMajor } from "./utils/get-expo-sdk-major.js";

// Ported from expo-doctor's `VectorIconsCheck` (sdkVersionRange `>=56`).
// Mixing the new scoped icon packages with `@expo/vector-icons` or the
// deprecated `react-native-vector-icons` leads to icon-rendering
// conflicts. expo-doctor resolves transitive deps; this static port keys
// off direct dependencies only.
const VECTOR_ICONS_MIN_SDK_MAJOR = 56;
const SCOPED_VECTOR_ICONS_PACKAGE = "@react-native-vector-icons/common";
const CONFLICTING_VECTOR_ICONS_PACKAGES: ReadonlyArray<string> = [
  "@expo/vector-icons",
  "react-native-vector-icons",
];

export const checkExpoVectorIcons = (rootDirectory: string): Diagnostic[] => {
  const packageJson = readPackageJson(path.join(rootDirectory, "package.json"));
  const expoSdkMajor = getExpoSdkMajor(packageJson);
  if (expoSdkMajor === null || expoSdkMajor < VECTOR_ICONS_MIN_SDK_MAJOR) return [];

  const directDependencyNames = getDirectDependencyNames(packageJson);
  const hasScopedPackage = directDependencyNames.has(SCOPED_VECTOR_ICONS_PACKAGE);
  const hasConflictingPackage = CONFLICTING_VECTOR_ICONS_PACKAGES.some((packageName) =>
    directDependencyNames.has(packageName),
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
