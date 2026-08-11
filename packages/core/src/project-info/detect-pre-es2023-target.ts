import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import ts from "typescript";
import { ES2023_YEAR, ES_TARGET_YEAR_BY_NAME, TSCONFIG_EXTENDS_MAX_DEPTH } from "../constants.js";
import { isFile, isPlainObject } from "./fs-utils.js";
import { isLocalModuleSpecifier } from "./is-local-module-specifier.js";

const TSCONFIG_FILENAME = "tsconfig.json";
const FALLBACK_TSCONFIG_FILENAMES = ["tsconfig.app.json", "tsconfig.build.json"] as const;

interface TsConfigCompilerOptions {
  readonly target?: string;
  readonly lib?: readonly string[];
  readonly hasExplicitLib: boolean;
}

interface TsConfigShape {
  readonly extends?: string;
  readonly referencePaths: readonly string[];
  readonly compilerOptions: TsConfigCompilerOptions;
}

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
  if (isLocalModuleSpecifier(extendsValue)) {
    const resolvedPath = path.resolve(fromConfigDirectory, extendsValue);
    if (isFile(resolvedPath)) return resolvedPath;
    const directoryConfigPath = path.join(resolvedPath, TSCONFIG_FILENAME);
    return isFile(directoryConfigPath) ? directoryConfigPath : ensureJsonExtension(resolvedPath);
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
    referencePaths: normalizeReferencePaths(parsed.config.references),
    compilerOptions: normalizeCompilerOptions(parsed.config.compilerOptions),
  };
};

const normalizeReferencePaths = (references: unknown): string[] => {
  if (!Array.isArray(references)) return [];
  return references
    .map((reference) =>
      isPlainObject(reference) && typeof reference.path === "string" ? reference.path : null,
    )
    .filter((referencePath): referencePath is string => referencePath !== null);
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
  let realPath: string;
  try {
    realPath = fs.realpathSync.native(tsConfigPath);
  } catch {
    return null;
  }
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
  if (compilerOptions.target) {
    return targetYearIsPreES2023(compilerOptions.target);
  }

  if (compilerOptions.hasExplicitLib) {
    return !libIncludesES2023(compilerOptions.lib ?? []);
  }

  return false;
};

const compilerOptionsDeclareTargetOrLib = (compilerOptions: TsConfigCompilerOptions): boolean =>
  compilerOptions.hasExplicitLib || compilerOptions.target !== undefined;

const detectPreES2023FromConfig = (
  tsConfigPath: string,
  visitedConfigPaths: ReadonlySet<string> = new Set(),
): boolean => {
  if (visitedConfigPaths.has(tsConfigPath)) return false;
  const compilerOptions = readResolvedCompilerOptions(tsConfigPath, 0, new Set());
  if (!compilerOptions) return false;
  if (!compilerOptionsDeclareTargetOrLib(compilerOptions)) {
    const tsConfig = readTsConfig(tsConfigPath);
    if (!tsConfig) return false;
    const nextVisitedConfigPaths = new Set(visitedConfigPaths);
    nextVisitedConfigPaths.add(tsConfigPath);
    const configDirectory = path.dirname(tsConfigPath);
    return tsConfig.referencePaths.some((referencePath) => {
      const resolvedReferencePath = path.resolve(configDirectory, referencePath);
      const referencedConfigPath = isFile(resolvedReferencePath)
        ? resolvedReferencePath
        : path.join(resolvedReferencePath, TSCONFIG_FILENAME);
      return (
        isFile(referencedConfigPath) &&
        detectPreES2023FromConfig(referencedConfigPath, nextVisitedConfigPaths)
      );
    });
  }
  return compilerOptionsArePreES2023(compilerOptions);
};

export const detectPreES2023Target = (directory: string): boolean => {
  const tsConfigPath = path.join(directory, TSCONFIG_FILENAME);
  if (isFile(tsConfigPath)) return detectPreES2023FromConfig(tsConfigPath);

  for (const fallbackFilename of FALLBACK_TSCONFIG_FILENAMES) {
    const fallbackPath = path.join(directory, fallbackFilename);
    if (isFile(fallbackPath)) return detectPreES2023FromConfig(fallbackPath);
  }

  return false;
};
