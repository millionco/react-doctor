import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { DeslopConfig, DeslopError, ScanResult } from "./types.js";
import {
  ConfigError,
  DetectorError,
  ResolverError,
  WorkspaceError,
  describeUnknownError,
} from "./errors.js";
import { OUTPUT_DIRECTORIES } from "./constants.js";
import { collectSourceFiles, resolveEntries, getFrameworkExclusions } from "./collect/entries.js";
import { resolveWorkspaces } from "./collect/workspaces.js";
import { parseFilesInParallel } from "./collect/parallel-parse.js";
import { createResolver } from "./resolver/resolve.js";
import { buildDependencyGraph } from "./linker/build.js";
import { buildModuleLinkInputs } from "./linker/build-module-link-inputs.js";
import { markFilenameRegistryEntries } from "./linker/mark-filename-registry-entries.js";
import { traceReachability } from "./linker/reachability.js";
import { resolveReExportChains } from "./linker/re-exports.js";
import { generateReport } from "./report/generate.js";
import { resolveEntriesInWorker } from "./collect/entries-in-worker.js";
import { loadSummaryCache } from "./summary-cache.js";
import { findMonorepoRoot } from "./utils/find-monorepo-root.js";
import { collectGitIgnoredPaths } from "./utils/collect-git-ignored-paths.js";

export { defineConfig } from "./config.js";

const REACT_NATIVE_ENABLERS = ["react-native", "expo"];

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
  SkippedDependency,
  SkippedDependencyReason,
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

  // Entry resolution always runs live — it reads config/doc/sibling-source
  // CONTENT that no name-based fingerprint can validate — but its result is
  // not needed until graph assembly. Uncached, it overlaps collection and the
  // parse pool on the main thread's awaits; with the incremental cache a warm
  // run has no parse window left to hide its mostly-synchronous work, so it
  // moves to a dedicated worker thread (spawned before the cache's tree walk,
  // which would otherwise serialize ahead of it).
  const entriesPromise = (
    configWithExclusions.incrementalCachePath
      ? resolveEntriesInWorker(configWithExclusions)
      : resolveEntries(configWithExclusions)
  ).catch((entriesError: unknown): Awaited<ReturnType<typeof resolveEntries>> => {
    setupErrors.push(
      new WorkspaceError({
        code: "workspace-discovery-failed",
        message: "resolveEntries failed — defaulting to empty entry set",
        path: config.rootDir,
        detail: describeUnknownError(entriesError),
      }),
    );
    return { productionEntries: [], testEntries: [], alwaysUsedFiles: [] };
  });

  const summaryCache = loadSummaryCache(configWithExclusions);

  let files: Awaited<ReturnType<typeof collectSourceFiles>>;
  const cachedFileList = summaryCache?.lookupFileList() ?? null;
  if (cachedFileList !== null) {
    files = cachedFileList;
  } else {
    try {
      files = await collectSourceFiles(configWithExclusions);
      summaryCache?.storeFileList(files);
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
  }
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
  const resolveModuleThroughCache = (
    specifier: string,
    fromFile: string,
  ): ReturnType<typeof moduleResolver.resolveModule> => {
    if (summaryCache === null) return moduleResolver.resolveModule(specifier, fromFile);
    const cachedResolution = summaryCache.lookupResolution(specifier, fromFile);
    if (cachedResolution !== null) return cachedResolution;
    const resolved = moduleResolver.resolveModule(specifier, fromFile);
    summaryCache.storeResolution(specifier, fromFile, resolved);
    return resolved;
  };

  let parsedModules: Awaited<ReturnType<typeof parseFilesInParallel>>;
  let summaryMissCount = 0;
  if (summaryCache === null) {
    parsedModules = await parseFilesInParallel(files);
  } else {
    parsedModules = new Array(files.length);
    const missedFiles: typeof files = [];
    const missedPositions: number[] = [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const cachedSummary = summaryCache.lookupSummary(files[fileIndex].path);
      if (cachedSummary !== null) {
        parsedModules[fileIndex] = cachedSummary;
        continue;
      }
      missedFiles.push(files[fileIndex]);
      missedPositions.push(fileIndex);
    }
    summaryMissCount = missedFiles.length;
    const parsedMissedModules = await parseFilesInParallel(missedFiles);
    for (let missIndex = 0; missIndex < missedFiles.length; missIndex++) {
      parsedModules[missedPositions[missIndex]] = parsedMissedModules[missIndex];
      summaryCache.storeSummary(missedFiles[missIndex].path, parsedMissedModules[missIndex]);
    }
  }

  const discoveredEntries = await entriesPromise;
  const moduleLinkInputsResult = buildModuleLinkInputs({
    files,
    parsedModules,
    resolvedEntries: discoveredEntries,
    gitIgnoredFilePaths: gitIgnoredFileSet,
    resolveModule: resolveModuleThroughCache,
  });
  setupErrors.push(...moduleLinkInputsResult.errors);

  let moduleGraph: ReturnType<typeof buildDependencyGraph>;
  try {
    moduleGraph = buildDependencyGraph(moduleLinkInputsResult.graphInputs);
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
    analysisResult = generateReport(moduleGraph, config, summaryCache ?? undefined);
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

  summaryCache?.save();

  if (summaryCache !== null) {
    analysisResult.incrementalCacheStats = {
      summaryHits: files.length - summaryMissCount,
      summaryMisses: summaryMissCount,
    };
  }

  if (setupErrors.length > 0) {
    analysisResult.analysisErrors = [...setupErrors, ...analysisResult.analysisErrors];
  }
  analysisResult.analysisTimeMs = performance.now() - pipelineStartTime;

  return analysisResult;
};
