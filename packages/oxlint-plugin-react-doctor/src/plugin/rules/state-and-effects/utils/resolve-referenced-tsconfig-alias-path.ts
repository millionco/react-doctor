import { REFERENCED_TSCONFIG_SINGLE_COUNT } from "./constants.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveModuleFileFromAbsolutePath } from "../../../utils/resolve-relative-import-path.js";
import { recordContentProbe } from "../../../utils/cross-file-probe-recorder.js";
import { resolveWebpackAliasPath } from "../../../utils/resolve-webpack-alias-path.js";
import { readDirectReferencedTsconfig } from "./read-direct-referenced-tsconfig.js";
import { isReferencedTsconfigAliasCongruentWithVite } from "../../../utils/is-referenced-tsconfig-alias-congruent-with-vite.js";

export interface ReferencedTsconfigAliasPath {
  readonly filePath: string;
  readonly relativeSpecifier: string;
}

export const resolveReferencedTsconfigAliasPath = (
  fromFilename: string,
  source: string,
): ReferencedTsconfigAliasPath | null => {
  if (resolveWebpackAliasPath(fromFilename, source)?.declared) return null;
  const configuration = readDirectReferencedTsconfig(fromFilename);
  if (
    !configuration ||
    /[!?#\\]/u.test(source) ||
    path.win32.isAbsolute(source) ||
    source.split("/").some((segment) => segment === "." || segment === "..")
  )
    return null;
  const matches: ReferencedTsconfigAliasPath[] = [];
  for (const [aliasPattern, targets] of Object.entries(configuration.paths)) {
    const prefix = aliasPattern.slice(0, -"*".length);
    if (!source.startsWith(prefix)) continue;
    if (
      !Array.isArray(targets) ||
      targets.length !== REFERENCED_TSCONFIG_SINGLE_COUNT ||
      typeof targets[0] !== "string"
    )
      return null;
    const targetPattern = targets[0];
    if (
      !targetPattern.endsWith("/*") ||
      targetPattern.slice(0, -"*".length).includes("*") ||
      path.isAbsolute(targetPattern) ||
      path.win32.isAbsolute(targetPattern) ||
      targetPattern.includes("\\")
    )
      return null;
    const targetRoot = path.resolve(
      configuration.baseDirectory,
      targetPattern.slice(0, -"/*".length),
    );
    if (path.relative(configuration.rootDirectory, targetRoot).startsWith("..")) return null;
    const substituted = path.resolve(targetRoot, source.slice(prefix.length));
    if (path.relative(targetRoot, substituted).startsWith("..")) return null;
    const filePath = resolveModuleFileFromAbsolutePath(substituted);
    if (
      !filePath ||
      path.relative(targetRoot, filePath).startsWith("..") ||
      fs.realpathSync(filePath) !== filePath ||
      !fs.lstatSync(filePath).isFile()
    )
      return null;
    recordContentProbe(filePath);
    if (
      !isReferencedTsconfigAliasCongruentWithVite({
        rootDirectory: configuration.rootDirectory,
        fromFilePath: fromFilename,
        specifier: source,
        resolvedFilePath: filePath,
        aliasPattern,
        targetPattern,
        baseDirectory: configuration.baseDirectory,
        configPath: configuration.configPath,
      })
    )
      return null;
    const relative = path
      .relative(path.dirname(path.resolve(fromFilename)), filePath)
      .split(path.sep)
      .join("/");
    matches.push({
      filePath,
      relativeSpecifier: relative.startsWith(".") ? relative : `./${relative}`,
    });
  }
  return matches.length === REFERENCED_TSCONFIG_SINGLE_COUNT ? matches[0] : null;
};
