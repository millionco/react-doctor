import type { Diagnostic } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";

// Script names that collide with binaries Expo relies on resolving from
// `node_modules/.bin`. A `scripts.expo` entry in particular shadows the
// Expo CLI and breaks builds. Ported from expo-doctor's `PackageJsonCheck`
// (which reads `node_modules/.bin`; this static port checks the two
// known-problematic binaries directly).
const CONFLICTING_SCRIPT_NAMES: ReadonlyArray<string> = ["expo", "react-native"];

export const checkExpoPackageJsonConflicts = (context: ExpoCheckContext): Diagnostic[] => {
  const { packageJson } = context;
  const diagnostics: Diagnostic[] = [];

  const conflictingScriptNames = CONFLICTING_SCRIPT_NAMES.filter((scriptName) =>
    Boolean(packageJson.scripts?.[scriptName]),
  );
  if (conflictingScriptNames.length > 0) {
    const quotedNames = conflictingScriptNames.map((name) => `"${name}"`).join(", ");
    diagnostics.push(
      buildExpoDiagnostic({
        rule: "expo-package-json-conflict",
        message: `package.json defines ${quotedNames} ${conflictingScriptNames.length === 1 ? "as a script that shadows" : "as scripts that shadow"} Expo/React Native binaries in node_modules/.bin, so tooling can run the local script instead of the expected CLI and fail builds.`,
        help: "Rename these scripts so they don't collide with the `expo` / `react-native` binaries",
      }),
    );
  }

  const packageName = packageJson.name;
  if (typeof packageName === "string" && context.directDependencyNames.has(packageName)) {
    diagnostics.push(
      buildExpoDiagnostic({
        rule: "expo-package-json-conflict",
        message: `package.json "name" is "${packageName}", which collides with a dependency of the same name, so package self-resolution can shadow the dependency and break imports that expect the installed package.`,
        help: "Rename your package so it no longer matches one of its dependencies",
      }),
    );
  }

  return diagnostics;
};
