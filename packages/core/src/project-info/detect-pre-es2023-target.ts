import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as ts from "typescript";
import { ES2023_YEAR, ES_TARGET_YEAR_BY_NAME, TSCONFIG_EXTENDS_MAX_DEPTH } from "../constants.js";
import { isFile } from "./utils/is-file.js";
import { isPlainObject } from "./utils/is-plain-object.js";

const TSCONFIG_FILENAME = "tsconfig.json";

interface TsConfigCompilerOptions {
  readonly target?: string;
  readonly lib?: readonly string[];
  readonly hasExplicitLib: boolean;
}

interface TsConfigShape {
  readonly extends?: string;
  readonly compilerOptions: TsConfigCompilerOptions;
}

const isRelativeExtendsValue = (extendsValue: string): boolean =>
  extendsValue.startsWith("./") || extendsValue.startsWith("../") || path.isAbsolute(extendsValue);

const ensureJsonExtension = (filePath: string): string =>
  path.extname(filePath) === "" ? `${filePath}.json` : filePath;

const resolvePackageExtendsPath = (
  extendsValue: string,
  fromConfigDirectory: string,
): string | null => {
  const requireFromConfig = createRequire(path.join(fromConfigDirectory, "tsconfig.json"));
  const candidates = [
    extendsValue,
    ensureJsonExtension(extendsValue),
    `${extendsValue.replace(/\/$/, "")}/tsconfig.json`,
  ];

  for (const candidate of candidates) {
    try {
      return requireFromConfig.resolve(candidate);
    } catch {
      continue;
    }
  }

  return null;
};

const resolveExtendsPath = (extendsValue: string, fromConfigDirectory: string): string | null => {
  if (isRelativeExtendsValue(extendsValue)) {
    return ensureJsonExtension(path.resolve(fromConfigDirectory, extendsValue));
  }

  return resolvePackageExtendsPath(extendsValue, fromConfigDirectory);
};

const normalizeCompilerOptions = (compilerOptions: unknown): TsConfigCompilerOptions => {
  if (!isPlainObject(compilerOptions)) return { hasExplicitLib: false };

  const target = typeof compilerOptions.target === "string" ? compilerOptions.target : undefined;
  const hasExplicitLib = Object.hasOwn(compilerOptions, "lib");
  const lib = Array.isArray(compilerOptions.lib)
    ? compilerOptions.lib.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  return { target, lib, hasExplicitLib };
};

const readTsConfig = (filePath: string): TsConfigShape | null => {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const parsed = ts.parseConfigFileTextToJson(filePath, content);
  if (!isPlainObject(parsed.config)) return null;

  return {
    extends: typeof parsed.config.extends === "string" ? parsed.config.extends : undefined,
    compilerOptions: normalizeCompilerOptions(parsed.config.compilerOptions),
  };
};

const mergeCompilerOptions = (
  inherited: TsConfigCompilerOptions | null,
  current: TsConfigCompilerOptions,
): TsConfigCompilerOptions => {
  const target = current.target ?? inherited?.target;
  const hasExplicitLib = current.hasExplicitLib || Boolean(inherited?.hasExplicitLib);
  const lib = current.hasExplicitLib ? current.lib : inherited?.lib;
  return { target, lib, hasExplicitLib };
};

const readResolvedCompilerOptions = (
  tsConfigPath: string,
  extendsDepth: number,
  visitedPaths: ReadonlySet<string>,
): TsConfigCompilerOptions | null => {
  const realPath = fs.realpathSync.native(tsConfigPath);
  if (visitedPaths.has(realPath)) return null;

  const tsConfig = readTsConfig(realPath);
  if (!tsConfig) return null;

  const nextVisitedPaths = new Set(visitedPaths);
  nextVisitedPaths.add(realPath);

  if (tsConfig.extends && extendsDepth < TSCONFIG_EXTENDS_MAX_DEPTH) {
    const parentPath = resolveExtendsPath(tsConfig.extends, path.dirname(realPath));
    if (parentPath && isFile(parentPath)) {
      const inherited = readResolvedCompilerOptions(parentPath, extendsDepth + 1, nextVisitedPaths);
      return mergeCompilerOptions(inherited, tsConfig.compilerOptions);
    }
  }

  return tsConfig.compilerOptions;
};

const targetYearIsPreES2023 = (target: string): boolean => {
  const year = ES_TARGET_YEAR_BY_NAME[target.toLowerCase()];
  return year !== undefined && year < ES2023_YEAR;
};

const libEntryIncludesES2023Array = (entry: string): boolean => {
  const normalizedEntry = entry.toLowerCase();
  if (normalizedEntry === "esnext" || normalizedEntry === "esnext.array") return true;
  const esYearMatch = /^es(\d{4})(?:\.(.+))?$/.exec(normalizedEntry);
  if (!esYearMatch) return false;

  const year = Number(esYearMatch[1]);
  if (year < ES2023_YEAR) return false;

  const component = esYearMatch[2];
  return component === undefined || component === "array";
};

const libIncludesES2023 = (lib: ReadonlyArray<string>): boolean =>
  lib.some(libEntryIncludesES2023Array);

const compilerOptionsArePreES2023 = (compilerOptions: TsConfigCompilerOptions): boolean => {
  if (compilerOptions.hasExplicitLib) {
    return !libIncludesES2023(compilerOptions.lib ?? []);
  }

  if (compilerOptions.target) {
    return targetYearIsPreES2023(compilerOptions.target);
  }

  return false;
};

const compilerOptionsDeclareTargetOrLib = (compilerOptions: TsConfigCompilerOptions): boolean =>
  compilerOptions.hasExplicitLib || compilerOptions.target !== undefined;

const detectPreES2023FromConfig = (tsConfigPath: string): boolean => {
  const compilerOptions = readResolvedCompilerOptions(tsConfigPath, 0, new Set());
  if (!compilerOptions) return false;
  if (!compilerOptionsDeclareTargetOrLib(compilerOptions)) return false;
  return compilerOptionsArePreES2023(compilerOptions);
};

export const detectPreES2023Target = (directory: string): boolean => {
  const tsConfigPath = path.join(directory, TSCONFIG_FILENAME);
  if (isFile(tsConfigPath)) return detectPreES2023FromConfig(tsConfigPath);

  return false;
};
