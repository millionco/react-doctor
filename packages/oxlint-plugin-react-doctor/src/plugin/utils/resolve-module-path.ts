import * as path from "node:path";
import { resolveRelativeImportPath } from "./resolve-relative-import-path.js";
import { resolveWebpackAliasPath } from "./resolve-webpack-alias-path.js";
import { resolveTsconfigAliasPath } from "./resolve-tsconfig-alias.js";

// Resolves an import `source` from `fromFilename` to a concrete file on
// disk. Relative imports (`./`, `../`) are resolved first; non-relative
// imports try supported Webpack script aliases, then tsconfig/jsconfig `paths` + `baseUrl` aliases
// (`@/components/Search`, etc.). Bare node-module specifiers that match
// no alias resolve to null — callers shouldn't follow into node_modules.
export const resolveModulePath = (fromFilename: string, source: string): string | null => {
  if (path.isAbsolute(source)) return null;
  if (source.startsWith(".")) return resolveRelativeImportPath(fromFilename, source);
  const webpackAlias = resolveWebpackAliasPath(fromFilename, source);
  if (webpackAlias?.declared) return webpackAlias.filePath;
  return resolveTsconfigAliasPath(fromFilename, source);
};
