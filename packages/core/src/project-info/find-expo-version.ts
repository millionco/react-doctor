import type { PackageJson } from "../types/index.js";
import { findInWorkspacePackageJsons } from "./find-in-workspace-package-jsons.js";
import { getDependencySpec } from "./utils/get-dependency-spec.js";

// The declared `expo` package version spec, looked up in the root manifest
// and then each workspace package — react-doctor's "is this an Expo
// project, and which SDK?" signal. Returns `null` when no package declares
// `expo`. The `expo` major tracks the Expo SDK release one-to-one
// (`expo@^51` ⇒ SDK 51), so callers parse the SDK major straight from this.
//
// Keyed off the `expo` package rather than `framework === "expo"` because
// `detectFramework` returns the first matching package, so a project
// declaring both `expo` and a web bundler (`vite` / `next`) classifies as
// the web framework yet is still an Expo project. The workspace walk also
// catches a web-rooted monorepo whose `apps/mobile` workspace targets Expo.
export const findExpoVersion = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
): string | null =>
  findInWorkspacePackageJsons(rootDirectory, rootPackageJson, (packageJson) =>
    getDependencySpec(packageJson, "expo"),
  );
