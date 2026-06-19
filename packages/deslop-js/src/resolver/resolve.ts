import { ResolverFactory } from "oxc-resolver";
import { dirname, resolve, join, basename, extname, sep, relative, isAbsolute } from "node:path";
import { existsSync, readFileSync, statSync } from "node:fs";
import fg from "fast-glob";
import type { DeslopConfig } from "../types.js";
import {
  RESOLVER_EXTENSIONS,
  REACT_NATIVE_PLATFORM_EXTENSIONS,
  OUTPUT_DIRECTORIES,
  SOURCE_EXTENSIONS,
} from "../constants.js";
import { resolveSourcePath } from "./source-path.js";
import { isPlatformBuiltinOrVirtualSpecifier } from "../utils/is-platform-builtin-or-virtual.js";
import { toPosixPath } from "../utils/to-posix-path.js";
import { sanitizeImportSpecifier } from "../utils/sanitize-import-specifier.js";

const fileExistsCache = new Map<string, boolean>();
const pathExistsCache = new Map<string, boolean>();
const fileContentCache = new Map<string, string>();

const cachedReadFileSync = (filePath: string): string => {
  const cached = fileContentCache.get(filePath);
  if (cached !== undefined) return cached;
  const content = readFileSync(filePath, "utf-8");
  fileContentCache.set(filePath, content);
  return content;
};

const cachedExistsSync = (targetPath: string): boolean => {
  const cached = pathExistsCache.get(targetPath);
  if (cached !== undefined) return cached;
  const result = existsSync(targetPath);
  pathExistsCache.set(targetPath, result);
  return result;
};

const existsAsFile = (filePath: string): boolean => {
  const cached = fileExistsCache.get(filePath);
  if (cached !== undefined) return cached;
  try {
    const result = cachedExistsSync(filePath) && statSync(filePath).isFile();
    fileExistsCache.set(filePath, result);
    return result;
  } catch {
    fileExistsCache.set(filePath, false);
    return false;
  }
};

export const trySourceFallback = (resolvedPath: string): string | undefined => {
  const segments = resolvedPath.split(sep);

  const isOutputDirectory = (segment: string): boolean =>
    OUTPUT_DIRECTORIES.some(
      (outputDirectory) => segment === outputDirectory || segment.startsWith(`${outputDirectory}-`),
    );

  let lastOutputPosition = -1;
  for (let index = segments.length - 1; index >= 0; index--) {
    if (isOutputDirectory(segments[index])) {
      lastOutputPosition = index;
      break;
    }
  }
  if (lastOutputPosition === -1) return undefined;

  let firstOutputPosition = lastOutputPosition;
  while (firstOutputPosition > 0 && isOutputDirectory(segments[firstOutputPosition - 1])) {
    firstOutputPosition--;
  }

  const prefix = segments.slice(0, firstOutputPosition).join(sep);
  const suffix = segments.slice(lastOutputPosition + 1).join(sep);
  if (!suffix) return undefined;

  const fileBaseName = basename(suffix);
  const fileExtension = extname(fileBaseName);
  const stemmedSuffix = fileExtension
    ? suffix.slice(0, suffix.length - fileExtension.length)
    : suffix;

  for (const sourceExtension of SOURCE_EXTENSIONS) {
    const sourceCandidate = join(prefix, "src", `${stemmedSuffix}.${sourceExtension}`);
    if (existsAsFile(sourceCandidate)) return sourceCandidate;
  }
  return undefined;
};

const resolvePathWithExtensionFallback = (candidatePath: string): string => {
  if (existsAsFile(candidatePath)) return candidatePath;
  for (const extension of RESOLVER_EXTENSIONS) {
    const withExtension = candidatePath + extension;
    if (existsAsFile(withExtension)) return withExtension;
  }
  for (const extension of RESOLVER_EXTENSIONS) {
    const indexCandidate = join(candidatePath, `index${extension}`);
    if (existsAsFile(indexCandidate)) return indexCandidate;
  }
  return candidatePath;
};

const resolveAliasTarget = (target: string): string | undefined => {
  if (existsAsFile(target)) return target;
  for (const extension of RESOLVER_EXTENSIONS) {
    if (cachedExistsSync(target + extension)) return target + extension;
  }
  const sourceTarget = target.replace(/\.[cm]?js$/, "");
  if (sourceTarget !== target) {
    for (const extension of RESOLVER_EXTENSIONS) {
      if (cachedExistsSync(sourceTarget + extension)) return sourceTarget + extension;
    }
  }
  const indexCandidate = join(target, "index");
  for (const extension of RESOLVER_EXTENSIONS) {
    if (cachedExistsSync(indexCandidate + extension)) return indexCandidate + extension;
  }
  return undefined;
};

export interface ResolvedImport {
  resolvedPath: string | undefined;
  isExternal: boolean;
  packageName: string | undefined;
}

interface CompiledPathMapping {
  prefix: string;
  suffix: string;
  isWildcard: boolean;
  targets: string[];
}

const pathMappingSpecificity = (mapping: CompiledPathMapping): number =>
  mapping.isWildcard ? mapping.prefix.length + mapping.suffix.length : Number.MAX_SAFE_INTEGER;

const compilePathMappings = (entries: Iterable<[string, string[]]>): CompiledPathMapping[] => {
  const compiled: CompiledPathMapping[] = [];
  for (const [pattern, targets] of entries) {
    const wildcardIndex = pattern.indexOf("*");
    if (wildcardIndex === -1) {
      compiled.push({ prefix: pattern, suffix: "", isWildcard: false, targets });
    } else {
      compiled.push({
        prefix: pattern.slice(0, wildcardIndex),
        suffix: pattern.slice(wildcardIndex + 1),
        isWildcard: true,
        targets,
      });
    }
  }
  compiled.sort((left, right) => pathMappingSpecificity(right) - pathMappingSpecificity(left));
  return compiled;
};

const matchCompiledMapping = (
  specifier: string,
  mappings: CompiledPathMapping[],
): string | undefined => {
  for (const mapping of mappings) {
    let matchedWildcard = "";
    if (mapping.isWildcard) {
      if (!specifier.startsWith(mapping.prefix) || !specifier.endsWith(mapping.suffix)) continue;
      matchedWildcard = specifier.slice(
        mapping.prefix.length,
        specifier.length - mapping.suffix.length,
      );
    } else if (specifier !== mapping.prefix) {
      continue;
    }
    for (const target of mapping.targets) {
      const resolved = resolveAliasTarget(target.replaceAll("*", matchedWildcard));
      if (resolved) return resolved;
    }
  }
  return undefined;
};

const EXTENSION_ALIAS = {
  ".js": [".ts", ".tsx", ".js", ".jsx"],
  ".jsx": [".tsx", ".jsx"],
  ".mjs": [".mts", ".mjs"],
  ".cjs": [".cts", ".cjs"],
};

const COMMON_RESOLVER_OPTIONS = {
  conditionNames: ["import", "require", "node", "default"],
  extensions: RESOLVER_EXTENSIONS,
  mainFields: ["module", "main", "browser"],
  extensionAlias: EXTENSION_ALIAS,
};

interface BundlerAlias {
  name: string;
  targetDirectory: string;
  isExact: boolean;
}

interface BundlerAliasConfig {
  scopeDirectory: string;
  aliases: BundlerAlias[];
  moduleDirectories: string[];
}

const WEBPACK_CONFIG_GLOBS = [
  "webpack.config.{js,ts,mjs,cjs}",
  "**/webpack*.config.{js,ts,mjs,cjs}",
  "**/webpack.config*.{js,ts,mjs,cjs}",
  "**/webpack*.config*.babel.{js,ts}",
];

const VITE_CONFIG_GLOBS = [
  "vite.config.{js,ts,mjs,cjs,mts,cts}",
  "vitest.config.{js,ts,mjs,cjs,mts,cts}",
  "**/vite.config.{js,ts,mjs,cjs,mts,cts}",
  "**/vitest.config.{js,ts,mjs,cjs,mts,cts}",
];

const BABEL_CONFIG_GLOBS = [
  "babel.config.{js,cjs,mjs,json}",
  ".babelrc",
  ".babelrc.{js,cjs,mjs,json}",
  "**/babel.config.{js,cjs,mjs,json}",
];

const JEST_CONFIG_GLOBS = [
  "jest.config.{js,ts,mjs,cjs,json}",
  "**/jest.config.{js,ts,mjs,cjs,json}",
];

const ALIAS_BLOCK_PATTERN = /alias\s*:\s*\{([\s\S]*?)\}/g;
const ALIAS_ENTRY_PATTERN =
  /["']?([@\w$./-]+)["']?\s*:\s*(?:path\.(?:resolve|join)\(\s*__dirname\s*,\s*((?:["'][^"']+["'][\s,]*)+)\)|fileURLToPath\(\s*new URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)\s*\)|["']([^"']+)["'])/g;
const JEST_MODULE_NAME_MAPPER_BLOCK_PATTERN = /moduleNameMapper\s*:\s*\{([\s\S]*?)\}/g;
const JEST_MODULE_NAME_MAPPER_ENTRY_PATTERN = /["']([^"']+)["']\s*:\s*["']([^"']+)["']/g;
const WEBPACK_MODULES_BLOCK_PATTERN = /modules\s*:\s*\[([\s\S]*?)\]/g;
const WEBPACK_PATH_CALL_PATTERN =
  /path\.(?:resolve|join)\(\s*__dirname\s*,\s*((?:["'][^"']+["'][\s,]*)+)\)/g;
const STRING_LITERAL_PATTERN = /["']([^"']+)["']/g;

const TSCONFIG_FILENAMES = [
  "tsconfig.json",
  "tsconfig.web.json",
  "tsconfig.app.json",
  "tsconfig.base.json",
  "jsconfig.json",
];

const findNearestTsconfig = (
  fromDir: string,
  rootDir: string,
  monorepoRootDir?: string,
): string | undefined => {
  let currentDirectory = fromDir;
  const stopAt = monorepoRootDir ? resolve(monorepoRootDir) : resolve(rootDir);

  while (currentDirectory.length >= stopAt.length) {
    for (const tsconfigFilename of TSCONFIG_FILENAMES) {
      const tsconfigCandidate = join(currentDirectory, tsconfigFilename);
      if (cachedExistsSync(tsconfigCandidate)) {
        return tsconfigCandidate;
      }
    }
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }

  return undefined;
};

export interface WorkspacePackageMap {
  name: string;
  directory: string;
}

const STYLE_FILE_EXTENSIONS = [".css", ".scss", ".less", ".sass"];
const SCSS_PARTIAL_EXTENSIONS = [".scss", ".sass", ".css"];

const resolveScssPartial = (specifier: string, fromDirectory: string): string | undefined => {
  const basePath = resolve(fromDirectory, specifier);
  const baseDirectory = dirname(basePath);
  const baseFileName = basePath.split("/").pop() ?? "";

  const candidates: string[] = [];

  for (const extension of SCSS_PARTIAL_EXTENSIONS) {
    if (!basePath.endsWith(extension)) {
      candidates.push(`${basePath}${extension}`);
      candidates.push(join(baseDirectory, `_${baseFileName}${extension}`));
    } else {
      candidates.push(basePath);
      candidates.push(join(baseDirectory, `_${baseFileName}`));
    }
  }

  candidates.push(join(basePath, `index.scss`));
  candidates.push(join(basePath, `_index.scss`));
  candidates.push(join(basePath, `index.sass`));
  candidates.push(join(basePath, `_index.sass`));

  for (const candidate of candidates) {
    if (cachedExistsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
};

const isInsideDirectory = (filePath: string, directory: string): boolean => {
  const relativePath = relative(directory, filePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const extractQuotedSegments = (value: string): string[] => {
  const segments: string[] = [];
  let segmentMatch: RegExpExecArray | null;
  STRING_LITERAL_PATTERN.lastIndex = 0;
  while ((segmentMatch = STRING_LITERAL_PATTERN.exec(value)) !== null) {
    segments.push(segmentMatch[1]);
  }
  return segments;
};

const resolveConfigPathValue = (value: string, configDirectory: string): string => {
  if (isAbsolute(value)) return value;
  return resolve(configDirectory, value);
};

const findConfigScope = (configPath: string, rootDir: string): string => {
  let currentDirectory = dirname(configPath);
  const absoluteRoot = resolve(rootDir);

  while (currentDirectory.length >= absoluteRoot.length) {
    if (cachedExistsSync(join(currentDirectory, "package.json"))) {
      return currentDirectory;
    }
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }

  return absoluteRoot;
};

const extractBundlerAliases = (content: string, configDirectory: string): BundlerAlias[] => {
  const aliases: BundlerAlias[] = [];
  let aliasBlockMatch: RegExpExecArray | null;
  ALIAS_BLOCK_PATTERN.lastIndex = 0;

  while ((aliasBlockMatch = ALIAS_BLOCK_PATTERN.exec(content)) !== null) {
    const aliasBlock = aliasBlockMatch[1];
    let aliasEntryMatch: RegExpExecArray | null;
    ALIAS_ENTRY_PATTERN.lastIndex = 0;

    while ((aliasEntryMatch = ALIAS_ENTRY_PATTERN.exec(aliasBlock)) !== null) {
      const rawName = aliasEntryMatch[1];
      const pathCallSegments = aliasEntryMatch[2];
      const fileUrlTarget = aliasEntryMatch[3];
      const stringTarget = aliasEntryMatch[4];
      const isExact = rawName.endsWith("$");
      const name = isExact ? rawName.slice(0, -1) : rawName.replace(/\/$/, "");

      let targetDirectory: string;
      if (pathCallSegments) {
        targetDirectory = resolve(configDirectory, ...extractQuotedSegments(pathCallSegments));
      } else if (fileUrlTarget) {
        targetDirectory = resolve(configDirectory, fileUrlTarget);
      } else if (stringTarget) {
        targetDirectory = resolveConfigPathValue(stringTarget, configDirectory);
      } else {
        continue;
      }

      aliases.push({ name, targetDirectory, isExact });
    }
  }

  return aliases;
};

const compileJestModuleNameMapperAlias = (
  pattern: string,
  target: string,
  configDirectory: string,
): BundlerAlias | undefined => {
  if (!target.includes("<rootDir>")) return undefined;

  const isWildcard = pattern.includes("(.*)") || pattern.includes("(.+)");
  const aliasName = pattern
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\(.)/g, "$1")
    .replace(/\/?\((?:\.\*|\.\+)\)$/, "")
    .replace(/\/$/, "");
  if (!aliasName) return undefined;

  const targetDirectory = target.replace(/<rootDir>/g, configDirectory).replace(/\/?\$\d+$/, "");

  return { name: aliasName, targetDirectory: resolve(targetDirectory), isExact: !isWildcard };
};

const extractJestModuleNameMapperAliases = (
  content: string,
  configDirectory: string,
): BundlerAlias[] => {
  const aliases: BundlerAlias[] = [];
  let blockMatch: RegExpExecArray | null;
  JEST_MODULE_NAME_MAPPER_BLOCK_PATTERN.lastIndex = 0;

  while ((blockMatch = JEST_MODULE_NAME_MAPPER_BLOCK_PATTERN.exec(content)) !== null) {
    const block = blockMatch[1];
    let entryMatch: RegExpExecArray | null;
    JEST_MODULE_NAME_MAPPER_ENTRY_PATTERN.lastIndex = 0;
    while ((entryMatch = JEST_MODULE_NAME_MAPPER_ENTRY_PATTERN.exec(block)) !== null) {
      const alias = compileJestModuleNameMapperAlias(entryMatch[1], entryMatch[2], configDirectory);
      if (alias) aliases.push(alias);
    }
  }

  return aliases;
};

const extractWebpackModuleDirectories = (content: string, configDirectory: string): string[] => {
  const moduleDirectories: string[] = [];
  let modulesBlockMatch: RegExpExecArray | null;
  WEBPACK_MODULES_BLOCK_PATTERN.lastIndex = 0;

  while ((modulesBlockMatch = WEBPACK_MODULES_BLOCK_PATTERN.exec(content)) !== null) {
    const modulesBlock = modulesBlockMatch[1];
    let pathCallMatch: RegExpExecArray | null;
    WEBPACK_PATH_CALL_PATTERN.lastIndex = 0;
    while ((pathCallMatch = WEBPACK_PATH_CALL_PATTERN.exec(modulesBlock)) !== null) {
      moduleDirectories.push(resolve(configDirectory, ...extractQuotedSegments(pathCallMatch[1])));
    }

    let stringMatch: RegExpExecArray | null;
    STRING_LITERAL_PATTERN.lastIndex = 0;
    while ((stringMatch = STRING_LITERAL_PATTERN.exec(modulesBlock)) !== null) {
      const moduleDirectory = stringMatch[1];
      if (moduleDirectory === "node_modules") continue;
      moduleDirectories.push(resolveConfigPathValue(moduleDirectory, configDirectory));
    }
  }

  return [...new Set(moduleDirectories)];
};

const isJestConfigPath = (configPath: string): boolean =>
  /(?:^|[\\/])jest\.config\.[^\\/]+$/.test(configPath);

const isWebpackConfigPath = (configPath: string): boolean => /webpack/.test(configPath);

const extractPackageJsonJestAliases = (rootDir: string): BundlerAlias[] => {
  try {
    const packageJson = JSON.parse(cachedReadFileSync(join(rootDir, "package.json")));
    const moduleNameMapper = packageJson?.jest?.moduleNameMapper;
    if (!moduleNameMapper || typeof moduleNameMapper !== "object") return [];
    const aliases: BundlerAlias[] = [];
    for (const [pattern, target] of Object.entries(moduleNameMapper)) {
      if (typeof target !== "string") continue;
      const alias = compileJestModuleNameMapperAlias(pattern, target, rootDir);
      if (alias) aliases.push(alias);
    }
    return aliases;
  } catch {
    return [];
  }
};

const loadBundlerAliasConfigs = (rootDir: string): BundlerAliasConfig[] => {
  const configPaths = fg.sync(
    [...WEBPACK_CONFIG_GLOBS, ...VITE_CONFIG_GLOBS, ...BABEL_CONFIG_GLOBS, ...JEST_CONFIG_GLOBS],
    {
      cwd: rootDir,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
      deep: 4,
    },
  );

  const configs: BundlerAliasConfig[] = [];
  for (const configPath of configPaths) {
    try {
      const content = cachedReadFileSync(configPath);
      const configDirectory = dirname(configPath);
      const aliases = extractBundlerAliases(content, configDirectory);
      if (isJestConfigPath(configPath)) {
        aliases.push(...extractJestModuleNameMapperAliases(content, configDirectory));
      }
      const moduleDirectories = isWebpackConfigPath(configPath)
        ? extractWebpackModuleDirectories(content, configDirectory)
        : [];
      if (aliases.length === 0 && moduleDirectories.length === 0) continue;

      configs.push({
        scopeDirectory: findConfigScope(configPath, rootDir),
        aliases,
        moduleDirectories,
      });
    } catch {
      continue;
    }
  }

  const packageJsonJestAliases = extractPackageJsonJestAliases(rootDir);
  if (packageJsonJestAliases.length > 0) {
    configs.push({
      scopeDirectory: resolve(rootDir),
      aliases: packageJsonJestAliases,
      moduleDirectories: [],
    });
  }

  return configs;
};

export interface ModuleResolverOptions {
  hasReactNative?: boolean;
  monorepoRoot?: string;
}

const isExportConditionRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const EXPORT_CONDITION_PRIORITY = ["import", "require", "default", "types"];

const resolveExportConditionTarget = (exportValue: unknown): string | undefined => {
  if (typeof exportValue === "string") return exportValue;
  if (!isExportConditionRecord(exportValue)) return undefined;
  for (const condition of EXPORT_CONDITION_PRIORITY) {
    const conditionTarget = resolveExportConditionTarget(exportValue[condition]);
    if (conditionTarget) return conditionTarget;
  }
  return undefined;
};

export const resolveWorkspaceSubpath = (
  workspaceDirectory: string,
  subpath: string,
): string | undefined => {
  const workspacePackageJsonPath = join(workspaceDirectory, "package.json");
  try {
    const workspacePackageContent = cachedReadFileSync(workspacePackageJsonPath);
    const workspacePackageJson = JSON.parse(workspacePackageContent);

    let resolvedEntryPath: string | undefined;
    if (subpath && workspacePackageJson.exports) {
      const exportKey = `./${subpath}`;
      const exactExportTarget = resolveExportConditionTarget(
        workspacePackageJson.exports[exportKey],
      );
      if (exactExportTarget) {
        const candidatePath = resolvePathWithExtensionFallback(
          resolve(workspaceDirectory, exactExportTarget),
        );
        resolvedEntryPath = existsAsFile(candidatePath)
          ? candidatePath
          : trySourceFallback(candidatePath);
      }

      if (!resolvedEntryPath) {
        for (const [wildcardPattern, wildcardTarget] of Object.entries(
          workspacePackageJson.exports,
        )) {
          if (!wildcardPattern.includes("*")) continue;
          const wildcardTargetValue = resolveExportConditionTarget(wildcardTarget);
          if (!wildcardTargetValue) continue;

          const wildcardPrefix = wildcardPattern.slice(0, wildcardPattern.indexOf("*"));
          const wildcardSuffix = wildcardPattern.slice(wildcardPattern.indexOf("*") + 1);
          if (exportKey.startsWith(wildcardPrefix) && exportKey.endsWith(wildcardSuffix)) {
            const matchedSegment = exportKey.slice(
              wildcardPrefix.length,
              exportKey.length - wildcardSuffix.length || undefined,
            );
            const expandedTarget = wildcardTargetValue.split("*").join(matchedSegment);
            const candidateWildcardPath = resolve(workspaceDirectory, expandedTarget);
            const candidatePath = resolvePathWithExtensionFallback(candidateWildcardPath);
            resolvedEntryPath = existsAsFile(candidatePath)
              ? candidatePath
              : trySourceFallback(candidatePath);
            break;
          }
        }
      }
    }

    if (subpath && !resolvedEntryPath) {
      const subpathCandidates = [
        resolve(workspaceDirectory, subpath),
        resolve(workspaceDirectory, "src", subpath),
      ];
      for (const directSubpath of subpathCandidates) {
        for (const candidateExtension of RESOLVER_EXTENSIONS) {
          const candidate = directSubpath + candidateExtension;
          if (cachedExistsSync(candidate)) {
            resolvedEntryPath = candidate;
            break;
          }
        }
        if (resolvedEntryPath) break;
        for (const candidateExtension of RESOLVER_EXTENSIONS) {
          const indexCandidate = join(directSubpath, `index${candidateExtension}`);
          if (cachedExistsSync(indexCandidate)) {
            resolvedEntryPath = indexCandidate;
            break;
          }
        }
        if (resolvedEntryPath) break;
      }
    }

    if (!subpath) {
      const mainField = workspacePackageJson.main ?? workspacePackageJson.module;
      if (typeof mainField === "string") {
        resolvedEntryPath = resolve(workspaceDirectory, mainField);
      }
      if (!resolvedEntryPath && workspacePackageJson.exports?.["."]) {
        const dotExportTarget = resolveExportConditionTarget(workspacePackageJson.exports["."]);
        if (dotExportTarget) {
          resolvedEntryPath = resolve(workspaceDirectory, dotExportTarget);
        }
      }
    }

    if (resolvedEntryPath) {
      const sourcePath = resolveSourcePath(resolvedEntryPath, workspaceDirectory);
      const finalPath = sourcePath ?? resolvedEntryPath;
      if (cachedExistsSync(finalPath)) return finalPath;
      const sourceFallbackPath = trySourceFallback(resolvedEntryPath);
      if (sourceFallbackPath) return sourceFallbackPath;
    }
  } catch {}
  return undefined;
};

export const createResolver = (
  config: DeslopConfig,
  workspacePackages: WorkspacePackageMap[] = [],
  options: ModuleResolverOptions = {},
) => {
  const resolverCache = new Map<string, ResolverFactory>();
  const resolveResultCache = new Map<string, ResolvedImport>();

  const failedTsconfigPaths = new Set<string>();

  const resolverExtensions = options.hasReactNative
    ? [...REACT_NATIVE_PLATFORM_EXTENSIONS, ...RESOLVER_EXTENSIONS]
    : RESOLVER_EXTENSIONS;

  const resolverOptions = {
    ...COMMON_RESOLVER_OPTIONS,
    extensions: resolverExtensions,
  };

  const getOrCreateResolver = (tsconfigPath: string | undefined): ResolverFactory => {
    const effectivePath =
      tsconfigPath && !failedTsconfigPaths.has(tsconfigPath) ? tsconfigPath : undefined;
    const cacheKey = effectivePath ?? "__no_tsconfig__";
    const existingResolver = resolverCache.get(cacheKey);
    if (existingResolver) return existingResolver;

    try {
      const newResolver = new ResolverFactory({
        ...resolverOptions,
        tsconfig: effectivePath ? { configFile: effectivePath, references: "auto" } : undefined,
      });
      resolverCache.set(cacheKey, newResolver);
      return newResolver;
    } catch {
      if (effectivePath) {
        failedTsconfigPaths.add(effectivePath);
        return getOrCreateResolver(undefined);
      }
      const fallbackResolver = new ResolverFactory(COMMON_RESOLVER_OPTIONS);
      resolverCache.set(cacheKey, fallbackResolver);
      return fallbackResolver;
    }
  };

  const workspaceNameToDirectory = new Map<string, string>();
  for (const workspacePackage of workspacePackages) {
    workspaceNameToDirectory.set(workspacePackage.name, workspacePackage.directory);
  }

  const structuralAliasToDirectory = new Map<string, string>();
  const workspaceScopes = new Set<string>();
  for (const workspacePackage of workspacePackages) {
    if (!workspacePackage.name.startsWith("@")) continue;
    const slashIndex = workspacePackage.name.indexOf("/");
    if (slashIndex !== -1) workspaceScopes.add(workspacePackage.name.slice(0, slashIndex));
  }
  if (workspaceScopes.size > 0) {
    const ambiguousStructuralKeys = new Set<string>();
    const registerStructuralAlias = (aliasKey: string, directory: string): void => {
      if (workspaceNameToDirectory.has(aliasKey)) return;
      const existing = structuralAliasToDirectory.get(aliasKey);
      if (existing !== undefined && existing !== directory) {
        ambiguousStructuralKeys.add(aliasKey);
        return;
      }
      structuralAliasToDirectory.set(aliasKey, directory);
    };
    for (const workspacePackage of workspacePackages) {
      const directoryBasename = basename(workspacePackage.directory);
      const slashIndex = workspacePackage.name.indexOf("/");
      const unscopedName =
        workspacePackage.name.startsWith("@") && slashIndex !== -1
          ? workspacePackage.name.slice(slashIndex + 1)
          : workspacePackage.name;
      for (const scope of workspaceScopes) {
        registerStructuralAlias(`${scope}/${directoryBasename}`, workspacePackage.directory);
        if (unscopedName && unscopedName !== directoryBasename) {
          registerStructuralAlias(`${scope}/${unscopedName}`, workspacePackage.directory);
        }
      }
    }
    for (const ambiguousKey of ambiguousStructuralKeys) {
      structuralAliasToDirectory.delete(ambiguousKey);
    }
  }

  const bundlerConfigRoots =
    options.monorepoRoot && options.monorepoRoot !== config.rootDir
      ? [config.rootDir, options.monorepoRoot]
      : [config.rootDir];
  const bundlerAliasConfigs = bundlerConfigRoots
    .flatMap(loadBundlerAliasConfigs)
    .sort(
      (leftConfig, rightConfig) =>
        rightConfig.scopeDirectory.length - leftConfig.scopeDirectory.length,
    );

  let rootTsconfigPath: string | undefined;
  if (config.tsConfigPath) {
    rootTsconfigPath = resolve(config.rootDir, config.tsConfigPath);
  } else {
    const tsconfigSearchDirs = options.monorepoRoot
      ? [config.rootDir, options.monorepoRoot]
      : [config.rootDir];
    for (const searchDir of tsconfigSearchDirs) {
      for (const candidate of TSCONFIG_FILENAMES) {
        const candidatePath = resolve(searchDir, candidate);
        if (cachedExistsSync(candidatePath)) {
          rootTsconfigPath = candidatePath;
          break;
        }
      }
      if (rootTsconfigPath) break;
    }
  }

  const tsconfigPathCache = new Map<string, string | undefined>();
  const tsconfigPathAliasCache = new Map<string, Map<string, string[]>>();
  const tsconfigCompiledAliasCache = new Map<string, CompiledPathMapping[]>();

  const findTsconfigForFile = (filePath: string): string | undefined => {
    const fileDir = dirname(filePath);
    const cached = tsconfigPathCache.get(fileDir);
    if (cached !== undefined) return cached;

    const found = findNearestTsconfig(fileDir, config.rootDir, options.monorepoRoot);
    const tsconfigResult = found ?? rootTsconfigPath;
    tsconfigPathCache.set(fileDir, tsconfigResult);
    return tsconfigResult;
  };

  const tsconfigBaseUrlCache = new Map<string, string | undefined>();

  const resolveExtendsPath = (extendsValue: string, fromDir: string): string | undefined => {
    if (extendsValue.startsWith(".")) {
      const absolutePath = resolve(fromDir, extendsValue);
      if (cachedExistsSync(absolutePath)) return absolutePath;
      if (cachedExistsSync(absolutePath + ".json")) return absolutePath + ".json";
      return undefined;
    }

    const nodeModulesRoot = options.monorepoRoot ?? config.rootDir;
    const packagePath = join(nodeModulesRoot, "node_modules", extendsValue);
    if (cachedExistsSync(packagePath)) return packagePath;
    if (cachedExistsSync(packagePath + ".json")) return packagePath + ".json";

    const localPackagePath = join(fromDir, "node_modules", extendsValue);
    if (cachedExistsSync(localPackagePath)) return localPackagePath;
    if (cachedExistsSync(localPackagePath + ".json")) return localPackagePath + ".json";

    return undefined;
  };

  const collectExtendsEntries = (tsconfigJson: Record<string, unknown>): string[] => {
    if (typeof tsconfigJson.extends === "string") return [tsconfigJson.extends];
    if (Array.isArray(tsconfigJson.extends)) {
      return tsconfigJson.extends.filter(
        (entry: unknown): entry is string => typeof entry === "string",
      );
    }
    return [];
  };

  const extractBaseUrlFromTsconfig = (
    tsconfigFile: string,
    visitedFiles: Set<string>,
  ): string | undefined => {
    if (visitedFiles.has(tsconfigFile)) return undefined;
    visitedFiles.add(tsconfigFile);

    try {
      const tsconfigContent = cachedReadFileSync(tsconfigFile);
      const cleanedContent = stripJsonComments(tsconfigContent);
      const tsconfigJson = JSON.parse(cleanedContent);
      const tsconfigDir = dirname(tsconfigFile);

      const baseUrl = tsconfigJson.compilerOptions?.baseUrl;
      if (baseUrl) return resolve(tsconfigDir, baseUrl);

      for (const extendsEntry of collectExtendsEntries(tsconfigJson)) {
        const resolvedPath = resolveExtendsPath(extendsEntry, tsconfigDir);
        if (resolvedPath) {
          const result = extractBaseUrlFromTsconfig(resolvedPath, visitedFiles);
          if (result) return result;
        }
      }
    } catch {
      return undefined;
    }
    return undefined;
  };

  const getBaseUrlDirectory = (tsconfigFile: string): string | undefined => {
    const cached = tsconfigBaseUrlCache.get(tsconfigFile);
    if (cached !== undefined) return cached;

    const result = extractBaseUrlFromTsconfig(tsconfigFile, new Set());
    tsconfigBaseUrlCache.set(tsconfigFile, result);
    return result;
  };

  const hasNextJsDependency = (() => {
    try {
      const rootPackageJson = JSON.parse(
        cachedReadFileSync(resolve(config.rootDir, "package.json")),
      );
      const allDeps = { ...rootPackageJson.dependencies, ...rootPackageJson.devDependencies };
      return "next" in allDeps;
    } catch {
      return false;
    }
  })();

  const packageDependencyCache = new Map<string, Set<string>>();

  const readPackageDependencies = (directory: string): Set<string> => {
    const cached = packageDependencyCache.get(directory);
    if (cached) return cached;

    const dependencies = new Set<string>();
    const packageJsonPath = join(directory, "package.json");
    try {
      const packageJson = JSON.parse(cachedReadFileSync(packageJsonPath));
      const dependencySections = [
        packageJson.dependencies,
        packageJson.devDependencies,
        packageJson.optionalDependencies,
      ];
      for (const dependencySection of dependencySections) {
        if (!dependencySection || typeof dependencySection !== "object") continue;
        for (const dependencyName of Object.keys(dependencySection)) {
          dependencies.add(dependencyName);
        }
      }
    } catch {}

    packageDependencyCache.set(directory, dependencies);
    return dependencies;
  };

  const findNearestPackageSrcDirectoryWithDependency = (
    filePath: string,
    dependencyNames: string[],
  ): string | undefined => {
    let currentDirectory = dirname(filePath);
    const stopAt = options.monorepoRoot ? resolve(options.monorepoRoot) : resolve(config.rootDir);

    while (currentDirectory.length >= stopAt.length) {
      if (cachedExistsSync(join(currentDirectory, "package.json"))) {
        const dependencies = readPackageDependencies(currentDirectory);
        if (dependencyNames.some((dependencyName) => dependencies.has(dependencyName))) {
          const srcDirectory = join(currentDirectory, "src");
          return cachedExistsSync(srcDirectory) ? srcDirectory : undefined;
        }
      }
      const parentDirectory = dirname(currentDirectory);
      if (parentDirectory === currentDirectory) break;
      currentDirectory = parentDirectory;
    }

    return undefined;
  };

  const extractPathsFromTsconfig = (
    tsconfigFile: string,
    visitedFiles: Set<string>,
  ): { paths: Record<string, string[]>; baseUrl: string; tsconfigDir: string } | undefined => {
    if (visitedFiles.has(tsconfigFile)) return undefined;
    visitedFiles.add(tsconfigFile);

    try {
      const tsconfigContent = cachedReadFileSync(tsconfigFile).trim();
      if (tsconfigContent.length === 0) return undefined;
      const cleanedContent = stripJsonComments(tsconfigContent);
      const tsconfigJson = JSON.parse(cleanedContent);
      const tsconfigDir = dirname(tsconfigFile);

      const paths = tsconfigJson.compilerOptions?.paths;
      const baseUrl = tsconfigJson.compilerOptions?.baseUrl;

      if (paths && typeof paths === "object") {
        return { paths, baseUrl: baseUrl ?? ".", tsconfigDir };
      }

      for (const extendsEntry of collectExtendsEntries(tsconfigJson)) {
        const resolvedPath = resolveExtendsPath(extendsEntry, tsconfigDir);
        if (resolvedPath) {
          const result = extractPathsFromTsconfig(resolvedPath, visitedFiles);
          if (result) return result;
        }
      }
    } catch {
      return undefined;
    }

    return undefined;
  };

  const getPathAliases = (tsconfigFile: string): Map<string, string[]> => {
    const cached = tsconfigPathAliasCache.get(tsconfigFile);
    if (cached) return cached;

    const aliasMap = new Map<string, string[]>();

    const extracted = extractPathsFromTsconfig(tsconfigFile, new Set());
    if (extracted) {
      for (const [pattern, targets] of Object.entries(extracted.paths)) {
        if (Array.isArray(targets)) {
          aliasMap.set(
            pattern,
            targets.map((target: string) =>
              resolve(extracted.tsconfigDir, extracted.baseUrl, target),
            ),
          );
        }
      }
    }

    if (aliasMap.size === 0 && hasNextJsDependency) {
      const tsconfigDir = dirname(tsconfigFile);
      const srcDirectory = resolve(tsconfigDir, "src");
      if (cachedExistsSync(srcDirectory)) {
        aliasMap.set("@/*", [resolve(tsconfigDir, "src/*")]);
      } else {
        aliasMap.set("@/*", [resolve(tsconfigDir, "*")]);
      }
    }

    tsconfigPathAliasCache.set(tsconfigFile, aliasMap);
    return aliasMap;
  };

  const getCompiledPathAliases = (tsconfigFile: string): CompiledPathMapping[] => {
    const cached = tsconfigCompiledAliasCache.get(tsconfigFile);
    if (cached) return cached;
    const compiled = compilePathMappings(getPathAliases(tsconfigFile));
    tsconfigCompiledAliasCache.set(tsconfigFile, compiled);
    return compiled;
  };

  const tryResolveViaPathAlias = (specifier: string, fromFile: string): string | undefined => {
    const tsconfigFile = findTsconfigForFile(fromFile);
    if (!tsconfigFile) return undefined;
    return matchCompiledMapping(specifier, getCompiledPathAliases(tsconfigFile));
  };

  const tryResolveFromDirectory = (directory: string, specifier: string): string | undefined => {
    const candidatePath = resolvePathWithExtensionFallback(resolve(directory, specifier));
    if (existsAsFile(candidatePath)) return candidatePath;
    return undefined;
  };

  const tryResolveViaBundlerAlias = (specifier: string, fromFile: string): string | undefined => {
    if (bundlerAliasConfigs.length === 0) return undefined;
    if (!isBareSpecifier(specifier)) return undefined;

    for (const bundlerConfig of bundlerAliasConfigs) {
      if (!isInsideDirectory(fromFile, bundlerConfig.scopeDirectory)) continue;

      for (const alias of bundlerConfig.aliases) {
        if (alias.isExact && specifier !== alias.name) continue;

        const suffix =
          specifier === alias.name
            ? ""
            : specifier.startsWith(`${alias.name}/`)
              ? specifier.slice(alias.name.length + 1)
              : undefined;
        if (suffix === undefined) continue;

        const aliasCandidate = tryResolveFromDirectory(alias.targetDirectory, suffix);
        if (aliasCandidate) return aliasCandidate;
      }

      for (const moduleDirectory of bundlerConfig.moduleDirectories) {
        const moduleCandidate = tryResolveFromDirectory(moduleDirectory, specifier);
        if (moduleCandidate) return moduleCandidate;
      }
    }

    return undefined;
  };

  const compiledConfigPaths = config.paths
    ? compilePathMappings(
        Object.entries(config.paths).map(([pattern, targets]) => [
          pattern,
          targets.map((target) => resolve(config.rootDir, target)),
        ]),
      )
    : [];

  const tryResolveViaConfigPaths = (specifier: string): string | undefined =>
    compiledConfigPaths.length === 0
      ? undefined
      : matchCompiledMapping(specifier, compiledConfigPaths);

  const tryResolveViaWorkspaceStructure = (specifier: string): string | undefined => {
    if (structuralAliasToDirectory.size === 0) return undefined;
    if (!isBareSpecifier(specifier)) return undefined;
    const packageKey = extractPackageNameFromSpecifier(specifier);
    const directory = structuralAliasToDirectory.get(packageKey);
    if (!directory) return undefined;
    const subpath =
      specifier.length > packageKey.length ? specifier.slice(packageKey.length + 1) : "";
    return resolveWorkspaceSubpath(directory, subpath);
  };

  const resolveModule = (specifier: string, fromFile: string): ResolvedImport => {
    const cleanedSpecifier = sanitizeImportSpecifier(specifier);
    const fromDir = dirname(fromFile);
    const cacheKey = `${fromDir}::${cleanedSpecifier}`;
    const cached = resolveResultCache.get(cacheKey);
    if (cached) return cached;

    if (isBuiltinModule(cleanedSpecifier)) {
      const resolvedResult: ResolvedImport = {
        resolvedPath: undefined,
        isExternal: true,
        packageName: cleanedSpecifier.startsWith("node:")
          ? cleanedSpecifier.slice(5)
          : cleanedSpecifier,
      };
      resolveResultCache.set(cacheKey, resolvedResult);
      return resolvedResult;
    }

    const isFromStyleFile = STYLE_FILE_EXTENSIONS.some((extension) => fromFile.endsWith(extension));
    if (isFromStyleFile && isBareSpecifier(cleanedSpecifier)) {
      const scssResolved = resolveScssPartial(cleanedSpecifier, fromDir);
      if (scssResolved) {
        const resolvedResult: ResolvedImport = {
          resolvedPath: scssResolved,
          isExternal: false,
          packageName: undefined,
        };
        resolveResultCache.set(cacheKey, resolvedResult);
        return resolvedResult;
      }
    }

    if (isBareSpecifier(cleanedSpecifier) && workspaceNameToDirectory.size > 0) {
      const packageName = extractPackageNameFromSpecifier(cleanedSpecifier);
      const workspaceDirectory = workspaceNameToDirectory.get(packageName);
      if (workspaceDirectory) {
        const resolvedWorkspacePath = resolveWorkspaceSubpath(
          workspaceDirectory,
          cleanedSpecifier.slice(packageName.length + 1),
        );
        if (resolvedWorkspacePath) {
          const resolvedResult: ResolvedImport = {
            resolvedPath: resolvedWorkspacePath,
            isExternal: false,
            packageName: undefined,
          };
          resolveResultCache.set(cacheKey, resolvedResult);
          return resolvedResult;
        }
      }
    }

    const tsconfigForFile = findTsconfigForFile(fromFile);
    const resolver = getOrCreateResolver(tsconfigForFile);

    const tryResolve = (activeResolver: ResolverFactory): ResolvedImport | undefined => {
      try {
        const resolverResult = activeResolver.sync(fromDir, cleanedSpecifier);
        if (resolverResult.path) {
          const normalizedResolvedPath = toPosixPath(resolverResult.path);
          const isInsideNodeModules = normalizedResolvedPath.includes("/node_modules/");
          return {
            resolvedPath: isInsideNodeModules ? undefined : normalizedResolvedPath,
            isExternal: isInsideNodeModules,
            packageName: isInsideNodeModules
              ? extractPackageNameFromSpecifier(cleanedSpecifier)
              : undefined,
          };
        }
      } catch {
        return undefined;
      }
      return undefined;
    };

    const resolversToAttempt = [
      resolver,
      ...(tsconfigForFile !== rootTsconfigPath && rootTsconfigPath
        ? [getOrCreateResolver(rootTsconfigPath)]
        : []),
      ...(tsconfigForFile ? [getOrCreateResolver(undefined)] : []),
    ];

    for (const activeResolver of resolversToAttempt) {
      const resolvedResult = tryResolve(activeResolver);
      if (resolvedResult) {
        resolveResultCache.set(cacheKey, resolvedResult);
        return resolvedResult;
      }
    }

    const pathAliasResolved = tryResolveViaPathAlias(cleanedSpecifier, fromFile);
    if (pathAliasResolved) {
      const resolvedResult: ResolvedImport = {
        resolvedPath: pathAliasResolved,
        isExternal: false,
        packageName: undefined,
      };
      resolveResultCache.set(cacheKey, resolvedResult);
      return resolvedResult;
    }

    const configPathResolved = tryResolveViaConfigPaths(cleanedSpecifier);
    if (configPathResolved) {
      const resolvedResult: ResolvedImport = {
        resolvedPath: configPathResolved,
        isExternal: false,
        packageName: undefined,
      };
      resolveResultCache.set(cacheKey, resolvedResult);
      return resolvedResult;
    }

    const bundlerAliasResolved = tryResolveViaBundlerAlias(cleanedSpecifier, fromFile);
    if (bundlerAliasResolved) {
      const resolvedResult: ResolvedImport = {
        resolvedPath: bundlerAliasResolved,
        isExternal: false,
        packageName: undefined,
      };
      resolveResultCache.set(cacheKey, resolvedResult);
      return resolvedResult;
    }

    const structuralResolved = tryResolveViaWorkspaceStructure(cleanedSpecifier);
    if (structuralResolved) {
      const resolvedResult: ResolvedImport = {
        resolvedPath: structuralResolved,
        isExternal: false,
        packageName: undefined,
      };
      resolveResultCache.set(cacheKey, resolvedResult);
      return resolvedResult;
    }

    if (isBareSpecifier(cleanedSpecifier)) {
      const tsconfigFile = findTsconfigForFile(fromFile);
      if (tsconfigFile) {
        const baseUrlDirectory = getBaseUrlDirectory(tsconfigFile);
        if (baseUrlDirectory) {
          const baseUrlCandidate = resolve(baseUrlDirectory, cleanedSpecifier);
          for (const candidateExtension of RESOLVER_EXTENSIONS) {
            const fullCandidate = baseUrlCandidate + candidateExtension;
            if (cachedExistsSync(fullCandidate)) {
              const resolvedResult: ResolvedImport = {
                resolvedPath: fullCandidate,
                isExternal: false,
                packageName: undefined,
              };
              resolveResultCache.set(cacheKey, resolvedResult);
              return resolvedResult;
            }
          }
          const indexCandidate = join(baseUrlCandidate, "index");
          for (const candidateExtension of RESOLVER_EXTENSIONS) {
            const fullCandidate = indexCandidate + candidateExtension;
            if (cachedExistsSync(fullCandidate)) {
              const resolvedResult: ResolvedImport = {
                resolvedPath: fullCandidate,
                isExternal: false,
                packageName: undefined,
              };
              resolveResultCache.set(cacheKey, resolvedResult);
              return resolvedResult;
            }
          }
        }
      }
      const createReactAppSrcDirectory = findNearestPackageSrcDirectoryWithDependency(fromFile, [
        "react-scripts",
        "react-app-rewired",
      ]);
      if (createReactAppSrcDirectory) {
        const craResolved = tryResolveFromDirectory(createReactAppSrcDirectory, cleanedSpecifier);
        if (craResolved) {
          const resolvedResult: ResolvedImport = {
            resolvedPath: craResolved,
            isExternal: false,
            packageName: undefined,
          };
          resolveResultCache.set(cacheKey, resolvedResult);
          return resolvedResult;
        }
      }
      const packageName = extractPackageNameFromSpecifier(cleanedSpecifier);
      const resolvedResult: ResolvedImport = {
        resolvedPath: undefined,
        isExternal: true,
        packageName,
      };
      resolveResultCache.set(cacheKey, resolvedResult);
      return resolvedResult;
    }

    if (cleanedSpecifier.startsWith(".")) {
      const relativeResolved = tryResolveFromDirectory(fromDir, cleanedSpecifier);
      if (relativeResolved && existsAsFile(relativeResolved)) {
        const resolvedResult: ResolvedImport = {
          resolvedPath: relativeResolved,
          isExternal: false,
          packageName: undefined,
        };
        resolveResultCache.set(cacheKey, resolvedResult);
        return resolvedResult;
      }
    }

    const unresolvedResult: ResolvedImport = {
      resolvedPath: undefined,
      isExternal: false,
      packageName: undefined,
    };
    resolveResultCache.set(cacheKey, unresolvedResult);
    return unresolvedResult;
  };

  const resolveModuleWithPosixPath = (specifier: string, fromFile: string): ResolvedImport => {
    const resolved = resolveModule(specifier, fromFile);
    return resolved.resolvedPath
      ? { ...resolved, resolvedPath: toPosixPath(resolved.resolvedPath) }
      : resolved;
  };

  return { resolveModule: resolveModuleWithPosixPath };
};

const stripJsonComments = (content: string): string => {
  let result = "";
  let insideString = false;
  let index = 0;

  while (index < content.length) {
    if (insideString) {
      if (content[index] === "\\" && index + 1 < content.length) {
        result += content[index] + content[index + 1];
        index += 2;
        continue;
      }
      if (content[index] === '"') {
        insideString = false;
      }
      result += content[index];
      index++;
      continue;
    }

    if (content[index] === '"') {
      insideString = true;
      result += content[index];
      index++;
      continue;
    }

    if (content[index] === "/" && index + 1 < content.length) {
      if (content[index + 1] === "/") {
        while (index < content.length && content[index] !== "\n") index++;
        continue;
      }
      if (content[index + 1] === "*") {
        index += 2;
        while (
          index + 1 < content.length &&
          !(content[index] === "*" && content[index + 1] === "/")
        )
          index++;
        index += 2;
        continue;
      }
    }

    result += content[index];
    index++;
  }

  return result.replace(/,(\s*[}\]])/g, "$1");
};

const isBuiltinModule = (specifier: string): boolean =>
  isPlatformBuiltinOrVirtualSpecifier(specifier);

const isBareSpecifier = (specifier: string): boolean =>
  !specifier.startsWith(".") && !specifier.startsWith("/");

const extractPackageNameFromSpecifier = (specifier: string): string => {
  if (specifier.startsWith("node:")) {
    return specifier.slice(5).split("/")[0];
  }

  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier;
  }

  return specifier.split("/")[0];
};
