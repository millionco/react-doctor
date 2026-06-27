import * as path from "node:path";
import { readPackageJson } from "../../project-info/index.js";
import { getLowestDependencyMajor } from "../../project-info/version.js";
import type { PackageJson } from "../../types/index.js";
import { getDirectDependencyNames } from "./utils/get-direct-dependency-names.js";

// The shared, read-once inputs every Expo check operates on. Building this
// once in the aggregator (rather than each check re-reading the manifest
// and re-deriving its dependency set) keeps the manifest a single source of
// truth and gives every check one uniform argument.
export interface ExpoCheckContext {
  readonly rootDirectory: string;
  readonly packageJson: PackageJson;
  readonly directDependencyNames: ReadonlySet<string>;
  /**
   * The resolved Expo SDK major, or `null` when the `expo` spec is a
   * dist-tag / `workspace:` / catalog reference that can't be parsed. The
   * `expo` package major tracks the SDK release one-to-one (`expo@51` ⇒
   * SDK 51).
   */
  readonly expoSdkMajor: number | null;
}

export const buildExpoCheckContext = (
  rootDirectory: string,
  expoVersion: string,
): ExpoCheckContext => {
  const packageJson = readPackageJson(path.join(rootDirectory, "package.json"));
  return {
    rootDirectory,
    packageJson,
    directDependencyNames: getDirectDependencyNames(packageJson),
    expoSdkMajor: getLowestDependencyMajor(expoVersion),
  };
};
