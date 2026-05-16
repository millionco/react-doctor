import path from "node:path";
import type { PackageJson } from "@react-doctor/types";
import { getWorkspacePatterns } from "./get-workspace-patterns.js";
import { readPackageJson } from "./read-package-json.js";
import { resolveWorkspaceDirectories } from "./resolve-workspace-directories.js";
import { isPackageJsonReactNativeAware } from "./utils/is-package-json-react-native-aware.js";

// True when the root manifest or any workspace package inside
// `rootDirectory` declares React Native. Walks workspaces with the
// same pattern resolver used elsewhere (`getWorkspacePatterns` +
// `resolveWorkspaceDirectories`) and short-circuits on the first
// match — most monorepos either have an obvious `apps/mobile` (hits
// almost immediately) or none at all (a single walk of the
// workspace globs, which we'd be doing anyway for React detection).
//
// Used so a web-rooted monorepo whose entry-point `package.json` is
// Next / Vite / Remix still loads `rn-*` rules when a sibling
// workspace targets React Native or Expo. The file-level package
// boundary in `oxlint-plugin-react-doctor` keeps those rules silent
// on the web workspaces — this just stops the rules from being
// dropped at the project level before the file-level gate gets a
// chance to run.
export const hasReactNativeWorkspaceAnywhere = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
): boolean => {
  if (isPackageJsonReactNativeAware(rootPackageJson)) return true;

  const patterns = getWorkspacePatterns(rootDirectory, rootPackageJson);
  if (patterns.length === 0) return false;

  const visitedDirectories = new Set<string>();
  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);
    for (const workspaceDirectory of directories) {
      if (visitedDirectories.has(workspaceDirectory)) continue;
      visitedDirectories.add(workspaceDirectory);
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));
      if (isPackageJsonReactNativeAware(workspacePackageJson)) return true;
    }
  }
  return false;
};
