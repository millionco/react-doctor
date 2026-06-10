import type { Diagnostic } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";
import { isExpoSdkAtLeast } from "./utils/is-expo-sdk-at-least.js";

// expo-router stopped being compatible with a directly-installed
// `@react-navigation/*` in SDK 56. Ported from expo-doctor's
// `ExpoRouterReactNavigationCheck`, whose `sdkVersionRange` is the *closed*
// `>=56.0.0 <57.0.0` — the incompatibility is scoped to the SDK 56 line, so
// the check must stay quiet on SDK 57+ (where expo-doctor no longer runs it)
// just as it does on SDK ≤55 and on projects whose SDK can't be resolved.
const EXPO_ROUTER_REACT_NAVIGATION_MIN_SDK_MAJOR = 56;
const EXPO_ROUTER_REACT_NAVIGATION_MAX_SDK_MAJOR_EXCLUSIVE = 57;

export const checkExpoRouterReactNavigation = (context: ExpoCheckContext): Diagnostic[] => {
  const { expoSdkMajor } = context;
  if (!isExpoSdkAtLeast(expoSdkMajor, EXPO_ROUTER_REACT_NAVIGATION_MIN_SDK_MAJOR)) return [];
  if (
    expoSdkMajor !== null &&
    expoSdkMajor >= EXPO_ROUTER_REACT_NAVIGATION_MAX_SDK_MAJOR_EXCLUSIVE
  ) {
    return [];
  }
  if (!context.directDependencyNames.has("expo-router")) return [];

  const reactNavigationNames = [...context.directDependencyNames]
    .filter((packageName) => packageName.startsWith("@react-navigation/"))
    .sort();
  if (reactNavigationNames.length === 0) return [];

  const quotedNames = reactNavigationNames.map((name) => `"${name}"`).join(", ");
  return [
    buildExpoDiagnostic({
      rule: "expo-router-no-react-navigation",
      message: `As of SDK 56, expo-router is no longer compatible with directly installed @react-navigation packages, so keeping ${quotedNames} can break routing or linking behavior after the SDK upgrade.`,
      help: "Remove these `@react-navigation/*` packages and replace direct imports with their expo-router equivalents. See https://docs.expo.dev/router/migrate/sdk-55-to-56/",
    }),
  ];
};
