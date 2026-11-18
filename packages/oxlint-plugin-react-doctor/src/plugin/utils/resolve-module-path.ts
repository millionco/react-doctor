import * as path from "node:path";
import { hasStaticNextModuleResolution } from "./has-static-next-module-resolution.js";
import { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";
import {
  resolveRelativeImportPath,
  resolveUniqueDirectModuleFile,
} from "./resolve-relative-import-path.js";
import { resolveTsconfigAliasPath } from "./resolve-tsconfig-alias.js";

// Resolves an import `source` from `fromFilename` to a concrete file on
// disk. Relative imports (`./`, `../`) are resolved first; non-relative
// imports fall back to tsconfig/jsconfig `paths` + `baseUrl` aliases
// (`@/components/Search`, etc.). Bare node-module specifiers that match
// no alias resolve to null — callers shouldn't follow into node_modules.
export const resolveModulePath = (fromFilename: string, source: string): string | null => {
  if (path.isAbsolute(source)) return null;
  return source.startsWith(".")
    ? resolveRelativeImportPath(fromFilename, source)
    : resolveTsconfigAliasPath(fromFilename, source);
};

export const resolveUniqueDirectModulePath = (
  fromFilename: string,
  source: string,
): string | null => {
  if (path.isAbsolute(source)) return null;
  const resolvedFilename = path.resolve(fromFilename);
  const packageDirectory = findNearestPackageDirectory(resolvedFilename);
  if (!packageDirectory || !hasStaticNextModuleResolution(packageDirectory)) return null;
  const resolvedPath = source.startsWith(".")
    ? resolveUniqueDirectModuleFile(path.resolve(path.dirname(resolvedFilename), source))
    : resolveTsconfigAliasPath(resolvedFilename, source, true);
  return resolvedPath && !resolvedPath.split(path.sep).includes("node_modules")
    ? resolvedPath
    : null;
};
