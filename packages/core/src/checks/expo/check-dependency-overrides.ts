import type { Diagnostic, PackageJson } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";

// SDK-critical packages whose versions are pinned to the Expo release and
// must not be overridden. Ported from the dependency chains in
// expo-doctor's `DependencyVersionOverrideCheck` — overriding any of these
// (commonly to silence a peer-dependency warning) is unsupported and
// causes hard-to-debug Metro/build failures.
const CRITICAL_OVERRIDE_NAMES: ReadonlySet<string> = new Set([
  "@expo/cli",
  "@expo/config",
  "@expo/metro-config",
  "@expo/metro-runtime",
  "@expo/metro",
  "metro",
]);

const isCriticalOverrideName = (packageName: string): boolean =>
  CRITICAL_OVERRIDE_NAMES.has(packageName) || packageName.startsWith("metro-");

// npm `overrides`, yarn/pnpm `resolutions`, and `pnpm.overrides` all pin
// transitive versions. We only read the top-level keys (package names).
const collectOverrideNames = (packageJson: PackageJson): ReadonlySet<string> =>
  new Set([
    ...Object.keys(packageJson.overrides ?? {}),
    ...Object.keys(packageJson.resolutions ?? {}),
    ...Object.keys(packageJson.pnpm?.overrides ?? {}),
  ]);

export const checkExpoDependencyOverrides = (context: ExpoCheckContext): Diagnostic[] => {
  const overriddenCriticalNames = [...collectOverrideNames(context.packageJson)]
    .filter(isCriticalOverrideName)
    .sort();

  if (overriddenCriticalNames.length === 0) return [];

  const quotedNames = overriddenCriticalNames.map((name) => `"${name}"`).join(", ");
  return [
    buildExpoDiagnostic({
      rule: "expo-no-conflicting-dependency-override",
      message: `package.json pins SDK-critical ${overriddenCriticalNames.length === 1 ? "package" : "packages"} via overrides/resolutions (${quotedNames}) — these versions are tied to the Expo SDK release and overriding them is unsupported and may break Metro or native builds`,
      help: `Remove the override/resolution for ${quotedNames} and reinstall so the Expo-pinned versions are used`,
    }),
  ];
};
