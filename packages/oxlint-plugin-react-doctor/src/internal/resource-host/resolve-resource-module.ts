import * as path from "node:path";
import {
  CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS,
  TSCONFIG_EXTENDS_MAX_DEPTH,
} from "../../plugin/constants/thresholds.js";
import { isResourceWithinRoot } from "./is-resource-within-root.js";
import type { ResourceHostBackend } from "./resource-host.js";

interface ResolvedResourceTsconfig {
  readonly baseAbsolutePath: string;
  readonly hasExplicitBaseUrl: boolean;
  readonly paths: ReadonlyMap<string, readonly string[]>;
}

const MODULE_FILE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const PACKAGE_EXPORT_CONDITIONS = ["import", "default", "module", "browser", "require"];
const PACKAGE_ENTRY_FIELDS = ["module", "main", "browser"];
const TSCONFIG_FILE_NAMES = ["tsconfig.json", "jsconfig.json"];

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const getConditionalExportEntry = (exportEntry: unknown): string | null => {
  if (typeof exportEntry === "string") return exportEntry;
  if (Array.isArray(exportEntry)) {
    for (const fallbackEntry of exportEntry) {
      const resolvedFallbackEntry = getConditionalExportEntry(fallbackEntry);
      if (resolvedFallbackEntry) return resolvedFallbackEntry;
    }
    return null;
  }
  if (!isObjectRecord(exportEntry)) return null;

  for (const condition of PACKAGE_EXPORT_CONDITIONS) {
    const nestedEntry = getConditionalExportEntry(exportEntry[condition]);
    if (nestedEntry) return nestedEntry;
  }
  return null;
};

const getPackageExportEntry = (packageManifest: Record<string, unknown>): string | null => {
  const exportsField = packageManifest.exports;
  if (!exportsField) return null;
  const directExportEntry = getConditionalExportEntry(exportsField);
  if (directExportEntry) return directExportEntry;
  return isObjectRecord(exportsField) ? getConditionalExportEntry(exportsField["."]) : null;
};

const getModuleFilePathCandidates = (modulePath: string): ReadonlyArray<string> => {
  const extension = path.extname(modulePath);
  if (!extension) {
    return MODULE_FILE_EXTENSIONS.map((moduleExtension) => `${modulePath}${moduleExtension}`);
  }

  const modulePathWithoutExtension = modulePath.slice(0, -extension.length);
  if (extension === ".js") {
    return [
      modulePath,
      `${modulePathWithoutExtension}.ts`,
      `${modulePathWithoutExtension}.tsx`,
      `${modulePathWithoutExtension}.jsx`,
    ];
  }
  if (extension === ".jsx") return [modulePath, `${modulePathWithoutExtension}.tsx`];
  if (extension === ".mjs") return [modulePath, `${modulePathWithoutExtension}.mts`];
  if (extension === ".cjs") return [modulePath, `${modulePathWithoutExtension}.cts`];
  return [modulePath];
};

const resolveModuleFilePath = (backend: ResourceHostBackend, modulePath: string): string | null => {
  const normalizedModulePath = backend.normalizePath(modulePath);
  if (backend.getPathKind(normalizedModulePath) === "file") return normalizedModulePath;
  for (const candidateFilePath of getModuleFilePathCandidates(normalizedModulePath)) {
    if (backend.getPathKind(candidateFilePath) === "file") {
      return backend.normalizePath(candidateFilePath);
    }
  }
  return null;
};

const resolveModulePathWithIndexFallback = (
  backend: ResourceHostBackend,
  modulePath: string,
): string | null =>
  resolveModuleFilePath(backend, modulePath) ??
  resolveModuleFilePath(backend, path.join(modulePath, "index"));

const resolvePackageDirectoryEntry = (
  backend: ResourceHostBackend,
  directoryPath: string,
): string | null => {
  const normalizedDirectoryPath = backend.normalizePath(directoryPath);
  if (backend.getPathKind(normalizedDirectoryPath) !== "directory") return null;
  const packageSourceText = backend.readText(path.join(normalizedDirectoryPath, "package.json"));
  if (packageSourceText === null) return null;

  try {
    const packageManifest: unknown = JSON.parse(packageSourceText);
    if (!isObjectRecord(packageManifest)) return null;
    const packageEntry =
      getPackageExportEntry(packageManifest) ??
      PACKAGE_ENTRY_FIELDS.map((fieldName) => packageManifest[fieldName]).find(
        (fieldValue): fieldValue is string => typeof fieldValue === "string",
      );
    return packageEntry
      ? resolveModulePathWithIndexFallback(
          backend,
          backend.normalizePath(path.resolve(normalizedDirectoryPath, packageEntry)),
        )
      : null;
  } catch {
    return null;
  }
};

export const resolveResourceModuleFileFromAbsolutePath = (
  backend: ResourceHostBackend,
  importPath: string,
): string | null =>
  resolveModuleFilePath(backend, importPath) ??
  resolvePackageDirectoryEntry(backend, importPath) ??
  resolveModuleFilePath(backend, path.join(importPath, "index"));

const stripJsonComments = (sourceText: string): string => {
  let output = "";
  let isInsideString = false;
  let isInsideLineComment = false;
  let isInsideBlockComment = false;
  for (let index = 0; index < sourceText.length; index++) {
    const character = sourceText[index];
    const nextCharacter = sourceText[index + 1];
    if (isInsideLineComment) {
      if (character === "\n") {
        isInsideLineComment = false;
        output += character;
      }
      continue;
    }
    if (isInsideBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        isInsideBlockComment = false;
        index++;
      }
      continue;
    }
    if (isInsideString) {
      output += character;
      if (character === "\\") {
        output += nextCharacter ?? "";
        index++;
      } else if (character === '"') {
        isInsideString = false;
      }
      continue;
    }
    if (character === '"') {
      isInsideString = true;
      output += character;
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      isInsideLineComment = true;
      index++;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      isInsideBlockComment = true;
      index++;
      continue;
    }
    output += character;
  }
  return output.replace(/,(\s*[}\]])/g, "$1");
};

const parsePathsField = (pathsField: unknown): ReadonlyMap<string, readonly string[]> => {
  const paths = new Map<string, readonly string[]>();
  if (!isObjectRecord(pathsField)) return paths;
  for (const [pattern, targets] of Object.entries(pathsField)) {
    if (!Array.isArray(targets)) continue;
    const stringTargets = targets.filter(
      (targetValue): targetValue is string => typeof targetValue === "string",
    );
    if (stringTargets.length > 0) paths.set(pattern, stringTargets);
  }
  return paths;
};

const resolveExtendsPath = (
  backend: ResourceHostBackend,
  extendsValue: string,
  fromConfigDirectory: string,
): string => {
  const withExtension = extendsValue.endsWith(".json") ? extendsValue : `${extendsValue}.json`;
  return backend.normalizePath(
    extendsValue.startsWith("./") || extendsValue.startsWith("../")
      ? path.resolve(fromConfigDirectory, withExtension)
      : path.join(fromConfigDirectory, "node_modules", withExtension),
  );
};

const readResolvedTsconfig = (
  backend: ResourceHostBackend,
  configFilePath: string,
  extendsDepth: number,
): ResolvedResourceTsconfig | null => {
  const sourceText = backend.readText(configFilePath);
  if (sourceText === null) return null;

  try {
    const parsedConfig: unknown = JSON.parse(stripJsonComments(sourceText));
    if (!isObjectRecord(parsedConfig)) return null;
    const configDirectory = path.dirname(configFilePath);
    const compilerOptions = isObjectRecord(parsedConfig.compilerOptions)
      ? parsedConfig.compilerOptions
      : {};
    const baseUrlValue =
      typeof compilerOptions.baseUrl === "string" ? compilerOptions.baseUrl : null;
    const hasExplicitBaseUrl = baseUrlValue !== null;
    const baseAbsolutePath = backend.normalizePath(
      baseUrlValue === null ? configDirectory : path.resolve(configDirectory, baseUrlValue),
    );

    if (isObjectRecord(compilerOptions.paths)) {
      return {
        baseAbsolutePath,
        hasExplicitBaseUrl,
        paths: parsePathsField(compilerOptions.paths),
      };
    }
    if (typeof parsedConfig.extends === "string" && extendsDepth < TSCONFIG_EXTENDS_MAX_DEPTH) {
      const inheritedConfig = readResolvedTsconfig(
        backend,
        resolveExtendsPath(backend, parsedConfig.extends, configDirectory),
        extendsDepth + 1,
      );
      if (inheritedConfig) return inheritedConfig;
    }
    return hasExplicitBaseUrl ? { baseAbsolutePath, hasExplicitBaseUrl, paths: new Map() } : null;
  } catch {
    return null;
  }
};

const findNearestTsconfig = (
  backend: ResourceHostBackend,
  fromDirectory: string,
): ResolvedResourceTsconfig | null => {
  let currentDirectory = backend.normalizePath(fromDirectory);
  for (let level = 0; level < CROSS_FILE_DIRECTORY_WALK_MAX_LEVELS; level++) {
    if (!isResourceWithinRoot(backend.rootDirectory, currentDirectory)) return null;
    for (const fileName of TSCONFIG_FILE_NAMES) {
      const candidateConfig = readResolvedTsconfig(
        backend,
        backend.normalizePath(path.join(currentDirectory, fileName)),
        0,
      );
      if (candidateConfig) return candidateConfig;
    }
    if (currentDirectory === backend.rootDirectory) return null;
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return null;
    currentDirectory = parentDirectory;
  }
  return null;
};

const matchPathPattern = (source: string, pattern: string): string | null => {
  const starIndex = pattern.indexOf("*");
  if (starIndex === -1) return source === pattern ? "" : null;
  const prefix = pattern.slice(0, starIndex);
  const suffix = pattern.slice(starIndex + 1);
  return source.length >= prefix.length + suffix.length &&
    source.startsWith(prefix) &&
    source.endsWith(suffix)
    ? source.slice(prefix.length, source.length - suffix.length)
    : null;
};

export const resolveResourceRelativeImport = (
  backend: ResourceHostBackend,
  fromFilename: string,
  source: string,
): string | null =>
  resolveResourceModuleFileFromAbsolutePath(
    backend,
    backend.normalizePath(path.resolve(path.dirname(backend.normalizePath(fromFilename)), source)),
  );

export const resolveResourceTsconfigAlias = (
  backend: ResourceHostBackend,
  fromFilename: string,
  source: string,
): string | null => {
  const resolvedConfig = findNearestTsconfig(
    backend,
    path.dirname(backend.normalizePath(fromFilename)),
  );
  if (!resolvedConfig) return null;

  let bestPattern: string | null = null;
  let bestCapture = "";
  let bestPrefixLength = -1;
  for (const pattern of resolvedConfig.paths.keys()) {
    const capture = matchPathPattern(source, pattern);
    if (capture === null) continue;
    const starIndex = pattern.indexOf("*");
    const prefixLength = starIndex === -1 ? pattern.length : starIndex;
    if (prefixLength <= bestPrefixLength) continue;
    bestPattern = pattern;
    bestCapture = capture;
    bestPrefixLength = prefixLength;
  }

  if (bestPattern) {
    for (const target of resolvedConfig.paths.get(bestPattern) ?? []) {
      const substitutedTarget = target.replaceAll("*", bestCapture);
      const resolvedTarget = resolveResourceModuleFileFromAbsolutePath(
        backend,
        backend.normalizePath(path.resolve(resolvedConfig.baseAbsolutePath, substitutedTarget)),
      );
      if (resolvedTarget) return resolvedTarget;
    }
  }
  return resolvedConfig.hasExplicitBaseUrl
    ? resolveResourceModuleFileFromAbsolutePath(
        backend,
        backend.normalizePath(path.resolve(resolvedConfig.baseAbsolutePath, source)),
      )
    : null;
};

export const resolveResourceImport = (
  backend: ResourceHostBackend,
  fromFilename: string,
  source: string,
): string | null => {
  if (path.isAbsolute(source)) return null;
  return source.startsWith(".")
    ? resolveResourceRelativeImport(backend, fromFilename, source)
    : resolveResourceTsconfigAlias(backend, fromFilename, source);
};
