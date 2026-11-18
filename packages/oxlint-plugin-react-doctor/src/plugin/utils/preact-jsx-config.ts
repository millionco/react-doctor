import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS,
  TSCONFIG_EXTENDS_MAX_DEPTH,
} from "../constants/thresholds.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { hasPreactViteRuntime } from "./preact-vite-runtime.js";
import { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";
import { readTsconfigFile } from "./resolve-tsconfig-alias.js";

interface ConfigPatterns {
  readonly directory: string;
  readonly entries: ReadonlyArray<string>;
}

interface JsxConfig {
  readonly directory: string;
  readonly options: Readonly<Record<string, unknown>>;
  readonly files?: ConfigPatterns;
  readonly include?: ConfigPatterns;
  readonly exclude?: ConfigPatterns;
  readonly references: ReadonlyArray<string>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readPatterns = (value: unknown, directory: string): ConfigPatterns | undefined => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return undefined;
  return { directory, entries: value };
};

const readJsxConfig = (configPath: string, depth: number): JsxConfig | null => {
  if (depth >= TSCONFIG_EXTENDS_MAX_DEPTH) return null;
  const raw = readTsconfigFile(configPath);
  if (!raw) return null;
  const directory = path.dirname(configPath);
  let inherited: JsxConfig | null = null;
  if (raw.extends !== undefined) {
    if (typeof raw.extends !== "string" || !/^\.\.?\//.test(raw.extends)) return null;
    const parentPath = path.resolve(
      directory,
      raw.extends.endsWith(".json") ? raw.extends : raw.extends + ".json",
    );
    inherited = readJsxConfig(parentPath, depth + 1);
    if (!inherited) return null;
  }

  const files = raw.files === undefined ? inherited?.files : readPatterns(raw.files, directory);
  const include =
    raw.include === undefined ? inherited?.include : readPatterns(raw.include, directory);
  const exclude =
    raw.exclude === undefined ? inherited?.exclude : readPatterns(raw.exclude, directory);
  if (
    (raw.files !== undefined && !files) ||
    (raw.include !== undefined && !include) ||
    (raw.exclude !== undefined && !exclude) ||
    (raw.compilerOptions !== undefined && !isRecord(raw.compilerOptions))
  ) {
    return null;
  }

  const references: Array<string> = [];
  if (raw.references !== undefined) {
    if (!Array.isArray(raw.references)) return null;
    for (const reference of raw.references) {
      if (!isRecord(reference) || typeof reference.path !== "string") return null;
      const referencePath = path.resolve(directory, reference.path);
      references.push(
        referencePath.endsWith(".json") ? referencePath : path.join(referencePath, "tsconfig.json"),
      );
    }
  }
  return {
    directory,
    options: { ...inherited?.options, ...raw.compilerOptions },
    files,
    include,
    exclude,
    references,
  };
};

const isInsideDirectory = (filename: string, directory: string): boolean => {
  const relativeFile = path.relative(directory, filename);
  return (
    relativeFile !== "" &&
    relativeFile !== ".." &&
    !relativeFile.startsWith(".." + path.sep) &&
    !path.isAbsolute(relativeFile)
  );
};

const matchesLiteralPatterns = (
  filename: string,
  patterns: ConfigPatterns,
  matchDirectories: boolean,
): boolean | null => {
  for (const entry of patterns.entries) {
    if (/[*?]/.test(entry)) return null;
    const absoluteEntry = path.resolve(patterns.directory, entry);
    if (filename === absoluteEntry) return true;
    if (matchDirectories && !path.extname(entry) && isInsideDirectory(filename, absoluteEntry)) {
      return true;
    }
  }
  return false;
};

const ownsFile = (filename: string, config: JsxConfig): boolean | null => {
  const isExplicitFile = config.files && matchesLiteralPatterns(filename, config.files, false);
  if (isExplicitFile === true || isExplicitFile === null) return isExplicitFile;
  if (config.include) {
    const included = matchesLiteralPatterns(filename, config.include, true);
    if (included !== true) return included;
  } else if (config.files || !isInsideDirectory(filename, config.directory)) {
    return false;
  }

  if (config.exclude) {
    const excluded = matchesLiteralPatterns(filename, config.exclude, true);
    if (excluded !== false) return excluded === null ? null : false;
  }
  // Implicit excludes vary with output-directory settings. Keep unknown
  // ownership when an inherited option could exclude this file.
  if (
    !config.exclude &&
    (config.options.outDir !== undefined || config.options.declarationDir !== undefined)
  ) {
    return null;
  }
  return !filename
    .split(path.sep)
    .some(
      (part) => part === "node_modules" || part === "bower_components" || part === "jspm_packages",
    );
};

const usesPreactRuntime = (options: JsxConfig["options"]): boolean => {
  if (options.jsx !== "react-jsx" && options.jsx !== "react-jsxdev") return false;
  if (
    options.jsxImportSource !== "preact" ||
    options.baseUrl !== undefined ||
    options.jsxFactory !== undefined ||
    options.jsxFragmentFactory !== undefined
  ) {
    return false;
  }
  if (options.paths === undefined) return true;
  if (!isRecord(options.paths)) return false;
  return Object.keys(options.paths).every(
    (key) => !key.includes("*") && key !== "preact" && !key.startsWith("preact/"),
  );
};

export const hasPreactJsxConfig = (filename: string): boolean => {
  if (!path.isAbsolute(filename) || path.extname(filename) !== ".tsx") return false;
  const absoluteFilePath = path.resolve(filename);
  let directory = path.dirname(absoluteFilePath);
  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level++) {
    const configPath = path.join(directory, "tsconfig.json");
    const config = readJsxConfig(configPath, 0);

    if (config) {
      const owns = ownsFile(absoluteFilePath, config);
      if (owns === null) return false;

      // A solution config can own files as well as reference an app config.
      // Infer a runtime only when exactly one supported project owns this file.
      let owner = owns ? config : undefined;
      for (const reference of config.references) {
        const referenced = readJsxConfig(reference, 0);
        if (!referenced || referenced.references.length > 0) return false;
        const referenceOwns = ownsFile(absoluteFilePath, referenced);
        if (referenceOwns === null) return false;
        if (!referenceOwns) continue;
        if (owner) return false;
        owner = referenced;
      }
      return (
        owner !== undefined &&
        usesPreactRuntime(owner.options) &&
        findNearestPackageDirectory(absoluteFilePath) === directory &&
        hasPreactViteRuntime(directory)
      );
    }

    // A malformed or unsupported config still shadows an ancestor config.
    recordExistenceProbe(configPath);
    if (existsSync(configPath)) return false;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return false;
};
