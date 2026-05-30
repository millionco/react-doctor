import path from "node:path";
import { readPackageJson } from "../../project-info/index.js";
import type { PackageJson } from "../../types/index.js";
import { getDirectDependencyNames } from "./utils/get-direct-dependency-names.js";
import { getExpoSdkMajor } from "./utils/get-expo-sdk-major.js";

// The shared, read-once inputs every Expo check operates on. Building this
// once in the aggregator (rather than each check re-reading the manifest
// and re-deriving its dependency set / SDK major) keeps the manifest a
// single source of truth and gives every check one uniform argument.
export interface ExpoCheckContext {
  readonly rootDirectory: string;
  readonly packageJson: PackageJson;
  readonly directDependencyNames: ReadonlySet<string>;
  readonly expoSdkMajor: number | null;
}

export const buildExpoCheckContext = (rootDirectory: string): ExpoCheckContext => {
  const packageJson = readPackageJson(path.join(rootDirectory, "package.json"));
  return {
    rootDirectory,
    packageJson,
    directDependencyNames: getDirectDependencyNames(packageJson),
    expoSdkMajor: getExpoSdkMajor(packageJson),
  };
};
