import type { Diagnostic } from "../../types/index.js";
import type { ExpoCheckContext } from "./expo-check-context.js";
import { buildExpoDiagnostic } from "./utils/build-expo-diagnostic.js";
import { isExpoSdkAtLeast } from "./utils/is-expo-sdk-at-least.js";

// expo-router stopped being compatible with a directly-installed
// `@react-navigation/*` in SDK 56. Ported from expo-doctor's
// `ExpoRouterReactNavigationCheck` (sdkVersionRange `>=56`). Gated on a
// resolved SDK major so projects on SDK ≤55 — where the pairing is
// supported — stay quiet, as do projects whose SDK can't be resolved.
const EXPO_ROUTER_REACT_NAVIGATION_MIN_SDK_MAJOR = 56;

export const checkExpoRouterReactNavigation = (context: ExpoCheckContext): Diagnostic[] => {
  if (!isExpoSdkAtLeast(context.expoSdkMajor, EXPO_ROUTER_REACT_NAVIGATION_MIN_SDK_MAJOR)) {
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
      message: `As of SDK 56, expo-router is no longer compatible with react-navigation, but ${quotedNames} ${reactNavigationNames.length === 1 ? "is" : "are"} installed as direct ${reactNavigationNames.length === 1 ? "dependency" : "dependencies"}`,
      help: "Remove these `@react-navigation/*` packages and replace direct imports with their expo-router equivalents. See https://docs.expo.dev/router/migrate/sdk-55-to-56/",
    }),
  ];
};
