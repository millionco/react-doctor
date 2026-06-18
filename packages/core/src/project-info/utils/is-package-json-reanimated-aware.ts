import type { PackageJson } from "../../types/index.js";
import { getDependencySpec } from "./get-dependency-spec.js";

// `react-native-reanimated` ships `.get()` / `.set()` accessors as the
// React Compiler-compatible alternative to `.value`. Detecting the
// dependency keeps the React Compiler `immutability` hint scoped to
// projects that can actually act on it. Checks the same four sections as
// the React Native gate so a reanimated dep in any section counts.
const REANIMATED_DEPENDENCY_NAME = "react-native-reanimated";

export const isPackageJsonReanimatedAware = (packageJson: PackageJson): boolean =>
  getDependencySpec(packageJson, REANIMATED_DEPENDENCY_NAME) !== null;
