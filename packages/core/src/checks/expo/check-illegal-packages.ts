import path from "node:path";
import { readPackageJson } from "../../project-info/index.js";
import type { Diagnostic } from "../../types/index.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";
import { getDirectDependencyNames } from "./utils/get-direct-dependency-names.js";

// Ported from expo-doctor's `IllegalPackageCheck`. The legacy unimodules
// packages were replaced by `expo-modules-core` in SDK 44 and break native
// builds when present.
const ILLEGAL_UNIMODULES_PACKAGES: ReadonlyArray<string> = [
  "@unimodules/core",
  "@unimodules/react-native-adapter",
  "react-native-unimodules",
];

export const checkExpoIllegalPackages = (rootDirectory: string): Diagnostic[] => {
  const packageJson = readPackageJson(path.join(rootDirectory, "package.json"));
  const directDependencyNames = getDirectDependencyNames(packageJson);
  return ILLEGAL_UNIMODULES_PACKAGES.filter((packageName) =>
    directDependencyNames.has(packageName),
  ).map((packageName) =>
    buildExpoDiagnostic({
      rule: "expo-no-unimodules-packages",
      message: `"${packageName}" is a legacy unimodules package that is incompatible with Expo SDK 44+ and will break native builds`,
      help: "Remove every `@unimodules/*` and `react-native-unimodules` package — their functionality now lives in `expo-modules-core`. See https://expo.fyi/r/sdk-44-remove-unimodules",
    }),
  );
};
