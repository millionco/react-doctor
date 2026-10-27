import { REFERENCED_TSCONFIG_SINGLE_COUNT } from "./constants.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS } from "../../../constants/thresholds.js";
import {
  JSX_TYPESCRIPT_CONFIG_FILE_NAMES,
  STANDARD_REACT_JSX_MODES,
} from "../../../constants/react.js";
import {
  recordContentProbe,
  recordExistenceProbe,
} from "../../../utils/cross-file-probe-recorder.js";
import {
  parseTsconfigFile,
  isTsconfigObjectRecord,
} from "../../../utils/resolve-tsconfig-alias.js";
import { matchTsconfigFilePattern } from "./match-tsconfig-file-pattern.js";

export interface DirectReferencedTsconfig {
  readonly configPath: string;
  readonly rootDirectory: string;
  readonly baseDirectory: string;
  readonly paths: Readonly<Record<string, unknown>>;
}

const isCanonicalRegularFile = (filename: string): boolean => {
  recordExistenceProbe(filename);
  recordContentProbe(filename);
  try {
    return fs.lstatSync(filename).isFile() && fs.realpathSync(filename) === filename;
  } catch {
    return false;
  }
};

const isSupportedPattern = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  !path.isAbsolute(value) &&
  !path.win32.isAbsolute(value) &&
  !/[\\?[\]{}!]/u.test(value) &&
  (value.includes("*") || path.extname(value) !== "") &&
  value
    .split("/")
    .every(
      (segment) =>
        segment !== ".." && segment !== "" && (segment === "**" || !segment.includes("**")),
    );

const readPatterns = (value: unknown): readonly string[] | null =>
  Array.isArray(value) && value.every(isSupportedPattern) ? value : null;

const ownsFile = (
  configuration: Record<string, unknown>,
  configPath: string,
  filename: string,
): boolean | null => {
  const relative = path.relative(path.dirname(configPath), filename).split(path.sep).join("/");
  if (
    relative.startsWith("../") ||
    path.isAbsolute(relative) ||
    relative.split("/").includes("node_modules")
  )
    return false;
  const files = Object.hasOwn(configuration, "files") ? readPatterns(configuration.files) : [];
  const includes = Object.hasOwn(configuration, "include")
    ? readPatterns(configuration.include)
    : [];
  const excludes = Object.hasOwn(configuration, "exclude")
    ? readPatterns(configuration.exclude)
    : [];
  if (
    !files ||
    !includes ||
    !excludes ||
    (!Object.hasOwn(configuration, "files") && !Object.hasOwn(configuration, "include"))
  )
    return null;
  if (files.some((pattern) => pattern.includes("*"))) return null;
  return (
    files.some((entry) => entry.replace(/^\.\//u, "") === relative) ||
    (includes.some((pattern) => matchTsconfigFilePattern(relative, pattern)) &&
      !excludes.some((pattern) => matchTsconfigFilePattern(relative, pattern)))
  );
};

export const readDirectReferencedTsconfig = (
  fromFilename: string,
): DirectReferencedTsconfig | false | null => {
  const filename = path.resolve(fromFilename);
  let directory = path.dirname(filename);
  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level++) {
    const present: string[] = [];
    for (const basename of JSX_TYPESCRIPT_CONFIG_FILE_NAMES) {
      const candidate = path.join(directory, basename);
      recordExistenceProbe(candidate);
      recordContentProbe(candidate);
      if (fs.lstatSync(candidate, { throwIfNoEntry: false })) present.push(candidate);
    }
    if (present.length > REFERENCED_TSCONFIG_SINGLE_COUNT) return false;
    if (present.length) {
      const solutionPath = present[0];
      if (!isCanonicalRegularFile(solutionPath)) return false;
      const solution = parseTsconfigFile(solutionPath, [], true);
      if (!solution || Array.isArray(solution)) return false;
      if (!Object.hasOwn(solution, "references")) return null;
      if (
        !Array.isArray(solution.files) ||
        solution.files.length ||
        Object.keys(solution).some((key) => key !== "files" && key !== "references") ||
        !Array.isArray(solution.references) ||
        !solution.references.length
      )
        return false;
      const configs = new Set<string>();
      const owners: DirectReferencedTsconfig[] = [];
      for (const reference of solution.references) {
        if (
          !isTsconfigObjectRecord(reference) ||
          Array.isArray(reference) ||
          Object.keys(reference).length !== REFERENCED_TSCONFIG_SINGLE_COUNT ||
          typeof reference.path !== "string" ||
          path.win32.isAbsolute(reference.path) ||
          !reference.path.startsWith("./") ||
          !reference.path.endsWith(".json") ||
          reference.path.includes("\\")
        )
          return false;
        const configPath = path.resolve(directory, reference.path);
        if (
          path.relative(directory, configPath).startsWith("..") ||
          configs.has(configPath) ||
          !isCanonicalRegularFile(configPath)
        )
          return false;
        configs.add(configPath);
        const configuration = parseTsconfigFile(configPath, [], true);
        if (
          !configuration ||
          Array.isArray(configuration) ||
          Object.hasOwn(configuration, "extends") ||
          Object.hasOwn(configuration, "references")
        )
          return false;
        const owns = ownsFile(configuration, configPath, filename);
        if (owns === null) return false;
        if (!owns) continue;
        const options = configuration.compilerOptions;
        if (
          !isTsconfigObjectRecord(options) ||
          Array.isArray(options) ||
          Object.hasOwn(options, "jsxFactory") ||
          Object.hasOwn(options, "jsxFragmentFactory") ||
          (Object.hasOwn(options, "jsxImportSource") && options.jsxImportSource !== "react") ||
          (Object.hasOwn(options, "jsx") &&
            (typeof options.jsx !== "string" || !STANDARD_REACT_JSX_MODES.has(options.jsx)))
        )
          return false;
        const paths = options.paths ?? {};
        if (!isTsconfigObjectRecord(paths) || Array.isArray(paths)) return false;
        for (const alias of Object.keys(paths)) {
          if (
            path.isAbsolute(alias) ||
            path.win32.isAbsolute(alias) ||
            !alias.endsWith("/*") ||
            alias.slice(0, -"*".length).includes("*") ||
            alias.startsWith("react/") ||
            alias === "react/*" ||
            alias === "react-dom/*" ||
            alias.startsWith("react-native")
          )
            return false;
        }
        if (
          Object.hasOwn(options, "baseUrl") &&
          (typeof options.baseUrl !== "string" ||
            path.isAbsolute(options.baseUrl) ||
            path.win32.isAbsolute(options.baseUrl) ||
            options.baseUrl.includes("\\"))
        )
          return false;
        const baseDirectory = path.resolve(
          path.dirname(configPath),
          typeof options.baseUrl === "string" ? options.baseUrl : ".",
        );
        if (
          path.relative(directory, baseDirectory).startsWith("..") ||
          fs.realpathSync(baseDirectory) !== baseDirectory
        )
          return false;
        owners.push({ configPath, rootDirectory: directory, baseDirectory, paths });
      }
      return owners.length === REFERENCED_TSCONFIG_SINGLE_COUNT ? owners[0] : false;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  return false;
};
