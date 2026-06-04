import path from "node:path";
import type { PackageJson } from "../types/index.js";
import { findMonorepoRoot } from "./find-monorepo-root.js";
import { isFile } from "./utils/is-file.js";
import { readPackageJson } from "./read-package-json.js";
import {
  extractCatalogName,
  isCatalogReference,
  resolveCatalogVersion,
} from "./resolve-catalog-version.js";

interface ResolveCatalogBackedDependencyVersionOptions {
  rootDirectory: string;
  rootPackageJson: PackageJson;
  packageName: string;
  version: string | null;
}

export const resolveCatalogBackedDependencyVersion = ({
  rootDirectory,
  rootPackageJson,
  packageName,
  version,
}: ResolveCatalogBackedDependencyVersionOptions): string | null => {
  if (version === null || !isCatalogReference(version)) return version;

  const catalogName = extractCatalogName(version);
  const resolvedLocalVersion = resolveCatalogVersion(
    rootPackageJson,
    packageName,
    rootDirectory,
    catalogName,
  );
  if (resolvedLocalVersion) return resolvedLocalVersion;

  const monorepoRoot = findMonorepoRoot(rootDirectory);
  if (!monorepoRoot) return version;

  const monorepoPackageJsonPath = path.join(monorepoRoot, "package.json");
  if (!isFile(monorepoPackageJsonPath)) return version;

  return (
    resolveCatalogVersion(
      readPackageJson(monorepoPackageJsonPath),
      packageName,
      monorepoRoot,
      catalogName,
    ) ?? version
  );
};
