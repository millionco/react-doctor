import type { Diagnostic, ProjectInfo } from "./types/index.js";
import { checkReactNativeLibraryDependencies } from "./checks/react-native/check-library-dependencies.js";
import { checkReactNativeMetroBabelPreset } from "./checks/react-native/check-metro-babel-preset.js";

// Project-level checks that apply to any React Native project (bare RN or
// Expo) — config/manifest footguns that aren't Expo-specific. Gated on the
// same React-Native signal that drives the `react-native` capability: the
// framework is RN/Expo, a workspace package targets RN, or an `expo`
// dependency is present (web-rooted monorepo with a mobile workspace). Like
// `checkExpoProject`, the run-inspect orchestrator skips this whole phase in
// diff/staged mode.
const isReactNativeProject = (project: ProjectInfo): boolean =>
  project.framework === "react-native" ||
  project.framework === "expo" ||
  project.hasReactNativeWorkspace ||
  project.expoVersion !== null;

export const checkReactNativeProject = (
  rootDirectory: string,
  project: ProjectInfo,
): Diagnostic[] => {
  if (!isReactNativeProject(project)) return [];
  return [
    ...checkReactNativeMetroBabelPreset(rootDirectory),
    ...checkReactNativeLibraryDependencies(rootDirectory),
  ];
};
