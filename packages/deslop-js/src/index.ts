import { resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import fg from "fast-glob";
import type { DeslopConfig, DeslopError, ScanResult } from "./types.js";
import {
  ConfigError,
  DetectorError,
  ResolverError,
  WorkspaceError,
  describeUnknownError,
} from "./errors.js";
import {
  DEFAULT_DUPLICATE_BLOCK_MIN_LINES,
  DEFAULT_DUPLICATE_BLOCK_MIN_OCCURRENCES,
  DEFAULT_DUPLICATE_BLOCK_MIN_TOKENS,
  DEFAULT_COGNITIVE_THRESHOLD,
  DEFAULT_CYCLOMATIC_THRESHOLD,
  DEFAULT_FUNCTION_LINE_THRESHOLD,
  DEFAULT_PARAM_COUNT_THRESHOLD,
  DEFAULT_ENTRY_GLOBS,
  DEFAULT_EXTENSIONS,
  DEFAULT_SEMANTIC_DECORATOR_ALLOWLIST,
  OUTPUT_DIRECTORIES,
} from "./constants.js";
import { collectSourceFiles, resolveEntries, getFrameworkExclusions } from "./collect/entries.js";
import { resolveWorkspaces } from "./collect/workspaces.js";
import { parseSourceFile } from "./collect/parse.js";
import { parseFilesInParallel } from "./collect/parallel-parse.js";
import { createResolver } from "./resolver/resolve.js";
import { buildDependencyGraph, type ModuleLinkInput } from "./linker/build.js";
import { traceReachability } from "./linker/reachability.js";
import { resolveReExportChains } from "./linker/re-exports.js";
import { generateReport } from "./report/generate.js";
import { findMonorepoRoot } from "./utils/find-monorepo-root.js";
import { collectGitIgnoredPaths } from "./utils/collect-git-ignored-paths.js";

const STYLE_EXTENSIONS = [".css", ".scss"];

const REACT_NATIVE_ENABLERS = ["react-native", "expo"];

const basenameFromPath = (filePath: string): string => {
  const lastSlashIndex = filePath.lastIndexOf("/");
  return lastSlashIndex === -1 ? filePath : filePath.slice(lastSlashIndex + 1);
};

/**
 * Dynamic registry pattern: many codebases use a central "schema/registry"
 * module that lists tool/command/page filenames as string literals, then a
 * runner spawns them via `path.resolve(dir, file)` or `import()`. Static
 * analysis can't follow the indirection, so those targets get falsely
 * flagged as unused.
 *
 * Heuristic: if a parsed string literal exactly matches the basename of
 * exactly one file in the project, treat that file as an entry point.
 * Uniqueness guards against false-positives from common names like
 * `index.ts` matching dozens of unrelated files.
 */
const markFilenameRegistryEntries = (
  moduleGraph: ReturnType<typeof buildDependencyGraph>,
): void => {
  const basenameToModuleIndex = new Map<string, number | "ambiguous">();
  for (const module of moduleGraph.modules) {
    const basename = basenameFromPath(module.fileId.path);
    const existing = basenameToModuleIndex.get(basename);
    if (existing === undefined) {
      basenameToModuleIndex.set(basename, module.fileId.index);
    } else if (existing !== "ambiguous") {
      basenameToModuleIndex.set(basename, "ambiguous");
    }
  }

  for (const module of moduleGraph.modules) {
    for (const referencedFilename of module.referencedFilenames) {
      const targetIndex = basenameToModuleIndex.get(referencedFilename);
      if (typeof targetIndex !== "number") continue;
      const targetModule = moduleGraph.modules[targetIndex];
      if (!targetModule || targetModule.isEntryPoint) continue;
      if (targetModule.fileId.index === module.fileId.index) continue;
      targetModule.isEntryPoint = true;
    }
  }
};

const detectReactNative = (
  rootDir: string,
  workspacePackages: Array<{ directory: string }>,
): boolean => {
  const directoriesToCheck = [
    rootDir,
    ...workspacePackages.map((workspacePackage) => workspacePackage.directory),
  ];
  for (const directory of directoriesToCheck) {
    const packageJsonPath = resolve(directory, "package.json");
    if (!existsSync(packageJsonPath)) continue;
    try {
      const content = readFileSync(packageJsonPath, "utf-8");
      const packageJson = JSON.parse(content);
      const allDependencies = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.optionalDependencies,
      };
      if (REACT_NATIVE_ENABLERS.some((enabler) => enabler in allDependencies)) return true;
    } catch {
      continue;
    }
  }
  return false;
};

export type {
  ScanResult,
  DeslopConfig,
  UnusedFile,
  UnusedExport,
  UnusedDependency,
  CircularDependency,
  UnusedType,
  UnusedTypeKind,
  SemanticConfig,
  SemanticConfidence,
  MisclassifiedDependency,
  DependencyDeclaredAs,
  UnusedEnumMember,
  UnusedClassMember,
  ClassMemberKind,
  RedundantAlias,
  RedundantAliasKind,
  DuplicateExport,
  DuplicateExportOccurrence,
  DuplicateImport,
  DuplicateImportOccurrence,
  RedundantTypePattern,
  RedundantTypePatternKind,
  IdentityWrapper,
  DuplicateTypeDefinition,
  DuplicateTypeDefinitionInstance,
  DuplicateInlineType,
  InlineTypeOccurrence,
  InlineTypeContext,
  SimplifiableFunction,
  SimplifiableFunctionKind,
  SimplifiableExpression,
  SimplifiableExpressionKind,
  DuplicateConstant,
  DuplicateConstantOccurrence,
  CrossFileDuplicateExport,
  CrossFileDuplicateExportLocation,
  DuplicateBlock,
  DuplicateBlockOccurrence,
  DuplicateBlockCluster,
  DuplicateBlockRefactoringKind,
  DuplicateBlockRefactoringHint,
  DuplicateBlockDetectionMode,
  DuplicateBlocksConfig,
  ShadowedDirectoryPair,
  ReExportCycle,
  ReExportCycleKind,
  FeatureFlag,
  FeatureFlagKind,
  FeatureFlagsConfig,
  FunctionComplexity,
  ComplexityConfig,
  PrivateTypeLeak,
  UnnecessaryAssertion,
  UnnecessaryAssertionKind,
  LazyImportAtTopLevel,
  LazyImportKind,
  CommonjsInEsm,
  CommonjsInEsmKind,
  TypeScriptEscapeHatch,
  TypeScriptEscapeHatchKind,
  DeslopError,
  DeslopErrorCode,
  DeslopErrorModule,
  DeslopErrorSeverity,
} from "./types.js";

/**
 * Default flags below mark rules off-by-default. Rationale for each:
 *
 * - `reportUnusedClassMembers: false` — class-member dead-code detection
 *   requires whole-program semantic analysis to be sound (subclass overrides,
 *   structural typing, framework method-by-name invocation like `@HttpGet`).
 *   When enabled on real React/Effect/NestJS codebases it produces a high
 *   rate of stylistic-FP findings (lifecycle methods, framework hooks). Off
 *   by default until the heuristics are tightened. Opt in via
 *   `semantic.reportUnusedClassMembers = true` when you accept the noise.
 *
 * - `reportTypes: false` — type-only exports are over-represented in
 *   barrel re-exports (the canonical `export type * from "./types"` pattern)
 *   and are rarely actionable signal. Off by default; opt in when auditing
 *   a type-heavy package.
 *
 * - `includeEntryExports: false` — exports from entry-point files are
 *   "API surface" and intentionally exported for external consumers; flagging
 *   them as "unused" is noise within a single repo scan. Opt in when auditing
 *   a package boundary (e.g. before deleting public APIs).
 *
 * - `reportRedundancy: true` — on because redundancy findings are mostly
 *   high-signal and the detectors carry their own confidence tiers.
 *
 * - `duplicateBlocks: undefined` — token-based copy-paste detection (suffix
 *   array + LCP) is opt-in. It re-parses every source
 *   file to emit a token stream and adds significant runtime to the scan.
 *   Pass `duplicateBlocks: { enabled: true }` to turn it on.
 */
const fillSemanticConfig = (
  semanticOverrides: Partial<DeslopConfig["semantic"]> | undefined,
): DeslopConfig["semantic"] => {
  const overrides = semanticOverrides ?? {};
  return {
    enabled: overrides.enabled ?? true,
    reportUnusedTypes: overrides.reportUnusedTypes ?? true,
    reportUnusedEnumMembers: overrides.reportUnusedEnumMembers ?? true,
    reportUnusedClassMembers: overrides.reportUnusedClassMembers ?? false,
    reportRedundantVariableAliases: overrides.reportRedundantVariableAliases ?? true,
    reportMisclassifiedDependencies: overrides.reportMisclassifiedDependencies ?? true,
    reportRoundTripAliases: overrides.reportRoundTripAliases ?? true,
    decoratorAllowlist: overrides.decoratorAllowlist ?? DEFAULT_SEMANTIC_DECORATOR_ALLOWLIST,
  };
};

const fillDuplicateBlocksConfig = (
  duplicateBlocksOverrides: Partial<DeslopConfig["duplicateBlocks"]> | undefined,
): DeslopConfig["duplicateBlocks"] => {
  const overrides = duplicateBlocksOverrides ?? {};
  return {
    enabled: overrides.enabled ?? true,
    mode: overrides.mode ?? "semantic",
    minTokens: overrides.minTokens ?? DEFAULT_DUPLICATE_BLOCK_MIN_TOKENS,
    minLines: overrides.minLines ?? DEFAULT_DUPLICATE_BLOCK_MIN_LINES,
    minOccurrences: overrides.minOccurrences ?? DEFAULT_DUPLICATE_BLOCK_MIN_OCCURRENCES,
    skipLocal: overrides.skipLocal ?? false,
  };
};

const fillFeatureFlagsConfig = (
  flagsOverrides: Partial<DeslopConfig["featureFlags"]> | undefined,
): DeslopConfig["featureFlags"] => {
  const overrides = flagsOverrides ?? {};
  return {
    enabled: overrides.enabled ?? true,
    extraEnvPrefixes: overrides.extraEnvPrefixes ?? [],
    extraSdkFunctionNames: overrides.extraSdkFunctionNames ?? [],
    detectConfigObjects: overrides.detectConfigObjects ?? false,
  };
};

const fillComplexityConfig = (
  complexityOverrides: Partial<DeslopConfig["complexity"]> | undefined,
): DeslopConfig["complexity"] => {
  const overrides = complexityOverrides ?? {};
  return {
    enabled: overrides.enabled ?? true,
    cyclomaticThreshold: overrides.cyclomaticThreshold ?? DEFAULT_CYCLOMATIC_THRESHOLD,
    cognitiveThreshold: overrides.cognitiveThreshold ?? DEFAULT_COGNITIVE_THRESHOLD,
    paramCountThreshold: overrides.paramCountThreshold ?? DEFAULT_PARAM_COUNT_THRESHOLD,
    functionLineThreshold: overrides.functionLineThreshold ?? DEFAULT_FUNCTION_LINE_THRESHOLD,
  };
};
export const defineConfig = (
  options: Partial<DeslopConfig> & { rootDir: string },
): DeslopConfig => ({
  rootDir: resolve(options.rootDir),
  entryPatterns: options.entryPatterns ?? DEFAULT_ENTRY_GLOBS,
  ignorePatterns: options.ignorePatterns ?? [],
  includeExtensions: options.includeExtensions ?? DEFAULT_EXTENSIONS,
  tsConfigPath: options.tsConfigPath,
  paths: options.paths,
  reportTypes: options.reportTypes ?? false,
  includeEntryExports: options.includeEntryExports ?? false,
  reportRedundancy: options.reportRedundancy ?? true,
  reportCodeQuality: options.reportCodeQuality ?? true,
  semantic: fillSemanticConfig(options.semantic),
  duplicateBlocks: fillDuplicateBlocksConfig(options.duplicateBlocks),
  featureFlags: fillFeatureFlagsConfig(options.featureFlags),
  complexity: fillComplexityConfig(options.complexity),
});

const buildEmptyScanResult = (errors: DeslopError[], elapsedMs: number): ScanResult => ({
  unusedFiles: [],
  unusedExports: [],
  unusedDependencies: [],
  circularDependencies: [],
  unusedTypes: [],
  misclassifiedDependencies: [],
  unusedEnumMembers: [],
  unusedClassMembers: [],
  redundantAliases: [],
  duplicateExports: [],
  duplicateImports: [],
  redundantTypePatterns: [],
  identityWrappers: [],
  duplicateTypeDefinitions: [],
  duplicateInlineTypes: [],
  simplifiableFunctions: [],
  simplifiableExpressions: [],
  duplicateConstants: [],
  crossFileDuplicateExports: [],
  duplicateBlocks: [],
  duplicateBlockClusters: [],
  shadowedDirectoryPairs: [],
  reExportCycles: [],
  featureFlags: [],
  complexFunctions: [],
  privateTypeLeaks: [],
  unnecessaryAssertions: [],
  lazyImportsAtTopLevel: [],
  commonjsInEsm: [],
  typeScriptEscapeHatches: [],
  analysisErrors: errors,
  totalFiles: 0,
  totalExports: 0,
  analysisTimeMs: elapsedMs,
});

const validateConfig = (config: DeslopConfig): DeslopError | undefined => {
  if (!config.rootDir || typeof config.rootDir !== "string") {
    return new ConfigError({ message: "config.rootDir must be a non-empty string" });
  }
  if (!existsSync(config.rootDir)) {
    return new ConfigError({
      message: `config.rootDir does not exist: ${config.rootDir}`,
      path: config.rootDir,
    });
  }
  return undefined;
};

export const analyze = async (config: DeslopConfig): Promise<ScanResult> => {
  const pipelineStartTime = performance.now();
  const setupErrors: DeslopError[] = [];

  const configValidationError = validateConfig(config);
  if (configValidationError) {
    return buildEmptyScanResult([configValidationError], performance.now() - pipelineStartTime);
  }

  let workspaceDiscovery: ReturnType<typeof resolveWorkspaces>;
  try {
    workspaceDiscovery = resolveWorkspaces(resolve(config.rootDir));
  } catch (workspaceError) {
    setupErrors.push(
      new WorkspaceError({
        code: "workspace-discovery-failed",
        message: "resolveWorkspaces threw — falling back to single-package mode",
        path: config.rootDir,
        detail: describeUnknownError(workspaceError),
      }),
    );
    workspaceDiscovery = {
      packages: [],
      excludedDirectories: [],
      hasRootLevelWorkspacePatterns: false,
    };
  }
  const workspacePackages = [...workspaceDiscovery.packages];

  let monorepoRoot: string | undefined;
  try {
    monorepoRoot = findMonorepoRoot(config.rootDir);
  } catch (monorepoError) {
    setupErrors.push(
      new WorkspaceError({
        code: "monorepo-discovery-failed",
        message: "findMonorepoRoot threw",
        path: config.rootDir,
        detail: describeUnknownError(monorepoError),
      }),
    );
    monorepoRoot = undefined;
  }
  if (monorepoRoot) {
    try {
      const monorepoWorkspaces = resolveWorkspaces(monorepoRoot);
      const existingDirectories = new Set(
        workspacePackages.map((workspacePackage) => workspacePackage.directory),
      );
      for (const monorepoPackage of monorepoWorkspaces.packages) {
        if (!existingDirectories.has(monorepoPackage.directory)) {
          workspacePackages.push(monorepoPackage);
        }
      }
    } catch (monorepoWorkspaceError) {
      setupErrors.push(
        new WorkspaceError({
          code: "workspace-discovery-failed",
          message: "resolveWorkspaces threw on monorepo root",
          path: monorepoRoot,
          detail: describeUnknownError(monorepoWorkspaceError),
        }),
      );
    }
  }

  let frameworkIgnorePatterns: string[] = [];
  try {
    frameworkIgnorePatterns = getFrameworkExclusions(config.rootDir);
  } catch (frameworkError) {
    setupErrors.push(
      new WorkspaceError({
        code: "workspace-discovery-failed",
        message: "getFrameworkExclusions failed — proceeding without framework exclusion patterns",
        path: config.rootDir,
        detail: describeUnknownError(frameworkError),
      }),
    );
  }

  const absoluteRoot = resolve(config.rootDir);
  const outputDirectoryExclusions = OUTPUT_DIRECTORIES.flatMap((outputDirectory) => [
    `${absoluteRoot}/${outputDirectory}/**`,
    `${absoluteRoot}/**/${outputDirectory}/**`,
  ]);

  const allExclusionPatterns = [
    ...workspaceDiscovery.excludedDirectories.map((directory) => `${directory}/**`),
    ...frameworkIgnorePatterns,
    ...outputDirectoryExclusions,
  ];

  const configWithExclusions =
    allExclusionPatterns.length > 0
      ? {
          ...config,
          ignorePatterns: [...config.ignorePatterns, ...allExclusionPatterns],
        }
      : config;

  let files: Awaited<ReturnType<typeof collectSourceFiles>>;
  let discoveredEntries: Awaited<ReturnType<typeof resolveEntries>>;
  try {
    const [collectedFiles, resolvedEntries] = await Promise.all([
      collectSourceFiles(configWithExclusions),
      resolveEntries(configWithExclusions).catch((entriesError: unknown) => {
        setupErrors.push(
          new WorkspaceError({
            code: "workspace-discovery-failed",
            message: "resolveEntries failed — defaulting to empty entry set",
            path: config.rootDir,
            detail: describeUnknownError(entriesError),
          }),
        );
        return {
          productionEntries: [] as string[],
          testEntries: [] as string[],
          alwaysUsedFiles: [] as string[],
        };
      }),
    ]);
    files = collectedFiles;
    discoveredEntries = resolvedEntries;
  } catch (collectError) {
    setupErrors.push(
      new WorkspaceError({
        code: "workspace-discovery-failed",
        severity: "fatal",
        message: "collectSourceFiles failed",
        path: config.rootDir,
        detail: describeUnknownError(collectError),
      }),
    );
    return buildEmptyScanResult(setupErrors, performance.now() - pipelineStartTime);
  }
  const productionEntrySet = new Set(discoveredEntries.productionEntries);
  const testEntrySet = new Set(discoveredEntries.testEntries);
  const alwaysUsedFileSet = new Set(discoveredEntries.alwaysUsedFiles);
  const gitIgnoreResult = collectGitIgnoredPaths(
    resolve(config.rootDir),
    files.map((file) => file.path),
  );
  const gitIgnoredFileSet = gitIgnoreResult.ignoredPaths;
  if (gitIgnoreResult.gitUnavailable) {
    setupErrors.push(
      new WorkspaceError({
        code: "gitignore-check-failed",
        severity: "info",
        message: "git unavailable — .gitignore filtering skipped",
        path: config.rootDir,
      }),
    );
  }

  let hasReactNative = false;
  try {
    hasReactNative = detectReactNative(config.rootDir, workspacePackages);
  } catch {
    hasReactNative = false;
  }

  let moduleResolver: ReturnType<typeof createResolver>;
  try {
    moduleResolver = createResolver(
      config,
      workspacePackages.map((workspacePackage) => ({
        name: workspacePackage.name,
        directory: workspacePackage.directory,
      })),
      { hasReactNative, monorepoRoot },
    );
  } catch (resolverError) {
    setupErrors.push(
      new ResolverError({
        message: "createResolver failed",
        path: config.rootDir,
        detail: describeUnknownError(resolverError),
      }),
    );
    return buildEmptyScanResult(setupErrors, performance.now() - pipelineStartTime);
  }
  const parsedModules = await parseFilesInParallel(files);

  const graphInputs: ModuleLinkInput[] = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const file = files[fileIndex];
    const parsedModule = parsedModules[fileIndex];
    const resolvedImportMap = new Map<string, ReturnType<typeof moduleResolver.resolveModule>>();

    const safeResolveImport = (
      specifier: string,
    ): ReturnType<typeof moduleResolver.resolveModule> => {
      try {
        return moduleResolver.resolveModule(specifier, file.path);
      } catch (resolveError) {
        setupErrors.push(
          new ResolverError({
            severity: "warning",
            message: `moduleResolver.resolveModule threw on specifier "${specifier}"`,
            path: file.path,
            detail: describeUnknownError(resolveError),
          }),
        );
        return { resolvedPath: undefined, isExternal: false, packageName: undefined };
      }
    };

    for (const importInfo of parsedModule.imports) {
      if (importInfo.isGlob) {
        const fileDir = dirname(file.path);
        let expandedFiles: string[] = [];
        try {
          expandedFiles = fg.sync(importInfo.specifier, {
            cwd: fileDir,
            absolute: true,
            onlyFiles: true,
            ignore: ["**/node_modules/**"],
          });
        } catch (globError) {
          setupErrors.push(
            new WorkspaceError({
              code: "workspace-discovery-failed",
              message: `fast-glob threw on import glob "${importInfo.specifier}"`,
              path: file.path,
              detail: describeUnknownError(globError),
            }),
          );
        }
        for (const expandedFile of expandedFiles) {
          resolvedImportMap.set(expandedFile, {
            resolvedPath: expandedFile,
            isExternal: false,
            packageName: undefined,
          });
        }
        resolvedImportMap.set(importInfo.specifier, {
          resolvedPath: undefined,
          isExternal: false,
          packageName: undefined,
        });
        continue;
      }
      resolvedImportMap.set(importInfo.specifier, safeResolveImport(importInfo.specifier));
    }

    for (const exportInfo of parsedModule.exports) {
      if (exportInfo.isReExport && exportInfo.reExportSource) {
        if (!resolvedImportMap.has(exportInfo.reExportSource)) {
          resolvedImportMap.set(
            exportInfo.reExportSource,
            safeResolveImport(exportInfo.reExportSource),
          );
        }
      }
    }

    const isAlwaysUsed = alwaysUsedFileSet.has(file.path);
    graphInputs.push({
      fileId: file,
      parsed: parsedModule,
      resolvedImports: resolvedImportMap,
      isEntryPoint:
        isAlwaysUsed || productionEntrySet.has(file.path) || testEntrySet.has(file.path),
      isTestEntry: testEntrySet.has(file.path),
      isGitIgnored: gitIgnoredFileSet.has(file.path),
    });
  }

  const discoveredFilePaths = new Set(files.map((file) => file.path));
  const styleFilesToAdd = new Set<string>();

  for (const input of graphInputs) {
    for (const [, resolvedImport] of input.resolvedImports) {
      if (!resolvedImport.resolvedPath || resolvedImport.isExternal) continue;
      if (discoveredFilePaths.has(resolvedImport.resolvedPath)) continue;
      const isStyleFile = STYLE_EXTENSIONS.some((ext) =>
        resolvedImport.resolvedPath!.endsWith(ext),
      );
      if (isStyleFile && existsSync(resolvedImport.resolvedPath)) {
        styleFilesToAdd.add(resolvedImport.resolvedPath);
      }
    }
  }

  const sortedStyleFiles = [...styleFilesToAdd].sort();
  let nextFileIndex = files.length;
  for (const styleFilePath of sortedStyleFiles) {
    const styleSourceFile = { index: nextFileIndex, path: styleFilePath };
    const parsedStyleModule = parseSourceFile(styleFilePath);
    const resolvedStyleImportMap = new Map<
      string,
      ReturnType<typeof moduleResolver.resolveModule>
    >();

    for (const importInfo of parsedStyleModule.imports) {
      let resolvedImport: ReturnType<typeof moduleResolver.resolveModule>;
      try {
        resolvedImport = moduleResolver.resolveModule(importInfo.specifier, styleFilePath);
      } catch (styleResolveError) {
        setupErrors.push(
          new ResolverError({
            severity: "warning",
            message: `moduleResolver.resolveModule threw on style import "${importInfo.specifier}"`,
            path: styleFilePath,
            detail: describeUnknownError(styleResolveError),
          }),
        );
        resolvedImport = { resolvedPath: undefined, isExternal: false, packageName: undefined };
      }
      resolvedStyleImportMap.set(importInfo.specifier, resolvedImport);
      if (resolvedImport.resolvedPath && !discoveredFilePaths.has(resolvedImport.resolvedPath)) {
        const isNestedStyle = STYLE_EXTENSIONS.some((ext) =>
          resolvedImport.resolvedPath!.endsWith(ext),
        );
        if (isNestedStyle && existsSync(resolvedImport.resolvedPath)) {
          styleFilesToAdd.add(resolvedImport.resolvedPath);
        }
      }
    }

    graphInputs.push({
      fileId: styleSourceFile,
      parsed: parsedStyleModule,
      resolvedImports: resolvedStyleImportMap,
      isEntryPoint: false,
      isTestEntry: false,
      isGitIgnored: gitIgnoredFileSet.has(styleFilePath),
    });
    discoveredFilePaths.add(styleFilePath);
    nextFileIndex++;
  }

  let moduleGraph: ReturnType<typeof buildDependencyGraph>;
  try {
    moduleGraph = buildDependencyGraph(graphInputs);
  } catch (graphError) {
    setupErrors.push(
      new DetectorError({
        module: "linker",
        severity: "fatal",
        message: "buildDependencyGraph threw",
        detail: describeUnknownError(graphError),
      }),
    );
    return buildEmptyScanResult(setupErrors, performance.now() - pipelineStartTime);
  }

  try {
    resolveReExportChains(moduleGraph);
  } catch (reExportError) {
    setupErrors.push(
      new DetectorError({
        module: "linker",
        message: "resolveReExportChains threw — re-export propagation skipped",
        detail: describeUnknownError(reExportError),
      }),
    );
  }

  markFilenameRegistryEntries(moduleGraph);

  try {
    traceReachability(moduleGraph);
  } catch (reachabilityError) {
    setupErrors.push(
      new DetectorError({
        module: "linker",
        message: "traceReachability threw — every module marked reachable to avoid over-reporting",
        detail: describeUnknownError(reachabilityError),
      }),
    );
    for (const module of moduleGraph.modules) module.isReachable = true;
  }

  let analysisResult: ScanResult;
  try {
    analysisResult = generateReport(moduleGraph, config);
  } catch (reportError) {
    setupErrors.push(
      new DetectorError({
        module: "report",
        severity: "fatal",
        message: "generateReport threw at the top level",
        detail: describeUnknownError(reportError),
      }),
    );
    return buildEmptyScanResult(setupErrors, performance.now() - pipelineStartTime);
  }

  if (setupErrors.length > 0) {
    analysisResult.analysisErrors = [...setupErrors, ...analysisResult.analysisErrors];
  }
  analysisResult.analysisTimeMs = performance.now() - pipelineStartTime;

  return analysisResult;
};
