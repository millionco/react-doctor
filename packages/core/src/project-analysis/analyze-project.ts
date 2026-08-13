import { relative, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type {
  CircularDependency,
  ProjectAnalysisConfig,
  ProjectAnalysisError,
  SkippedDependency,
  UnusedDependency,
  UnusedExport,
  UnusedFile,
} from "./types.js";
import {
  ConfigError,
  DetectorError,
  ResolverError,
  WorkspaceError,
  describeUnknownError,
} from "./errors.js";
import {
  OUTPUT_DIRECTORIES,
  REACT_NATIVE_ADDITIONAL_PLATFORM_SUFFIXES,
  TARO_PLATFORM_SUFFIXES,
} from "./constants.js";
import { collectSourceFiles, resolveEntries, getFrameworkExclusions } from "./collect/entries.js";
import { resolveWorkspaces } from "./collect/workspaces.js";
import { parseSourceFile } from "./collect/parse.js";
import { createResolver } from "./resolver/resolve.js";
import { buildDependencyGraph } from "./linker/build.js";
import { buildModuleLinkInputs } from "./linker/build-module-link-inputs.js";
import { markFilenameRegistryEntries } from "./linker/mark-filename-registry-entries.js";
import { traceReachability } from "./linker/reachability.js";
import { resolveReExportChains } from "./linker/re-exports.js";
import { isPathInsideDirectoryOrEqual } from "./utils/is-path-inside-directory-or-equal.js";
import { detectCycles } from "./report/cycles.js";
import { detectDeadExports } from "./report/exports.js";
import { detectOrphanFiles } from "./report/files.js";
import { detectStalePackages } from "./report/packages.js";
import { findMonorepoRoot } from "./utils/find-monorepo-root.js";
import { collectGitIgnoredPaths } from "./utils/collect-git-ignored-paths.js";
import { defineProjectAnalysisConfig } from "./config.js";
import { runSafeDetector } from "./utils/run-safe-detector.js";
import { collectGitLinguistIgnoredPaths } from "../utils/collect-git-linguist-ignored-paths.js";
import { toPosixPath } from "./utils/to-posix-path.js";
import { extractBuildScriptConsumedFiles } from "./collect/build-script-consumed-files.js";
import { buildPlatformSiblingIndex } from "./utils/build-platform-sibling-index.js";
import { collectUnpluginAutoImportReferences } from "./collect/unplugin-auto-import-entries.js";
import { markCompletePackageGraphs } from "./utils/mark-complete-package-graphs.js";

export interface AnalyzeProjectInput {
  readonly rootDirectory: string;
  readonly entryPatterns?: ReadonlyArray<string>;
  readonly ignorePatterns?: ReadonlyArray<string>;
  readonly tsConfigPath?: string;
}

export interface ProjectAnalysisResult {
  readonly unusedFiles: ReadonlyArray<UnusedFile>;
  readonly unusedExports: ReadonlyArray<UnusedExport>;
  readonly unusedDependencies: ReadonlyArray<UnusedDependency>;
  readonly circularDependencies: ReadonlyArray<CircularDependency>;
  readonly analysisErrors: ReadonlyArray<ProjectAnalysisError>;
  readonly totalFiles: number;
  readonly totalExports: number;
  readonly analysisTimeMs: number;
}

interface ProjectAnalysisWorkerResult extends ProjectAnalysisResult {
  readonly skippedDependencies: ReadonlyArray<SkippedDependency>;
}

interface ProjectAnalysisInternalResult extends ProjectAnalysisWorkerResult {
  readonly verifiedUnusedFiles: ReadonlyArray<UnusedFile>;
}

const REACT_NATIVE_ENABLERS = ["react-native", "expo"];
const TARO_ENABLER_PREFIX = "@tarojs/";

interface PlatformCapabilities {
  hasReactNative: boolean;
  hasTaro: boolean;
}

interface PlatformCapabilityRoot extends PlatformCapabilities {
  directory: string;
}

const detectPlatformCapabilities = (directory: string): PlatformCapabilities => {
  const packageJsonPath = resolve(directory, "package.json");
  if (!existsSync(packageJsonPath)) return { hasReactNative: false, hasTaro: false };
  const content = readFileSync(packageJsonPath, "utf-8");
  const packageJson = JSON.parse(content);
  const allDependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.optionalDependencies,
  };
  const dependencyNames = Object.keys(allDependencies);
  return {
    hasReactNative: REACT_NATIVE_ENABLERS.some((enabler) => enabler in allDependencies),
    hasTaro: dependencyNames.some((dependencyName) =>
      dependencyName.startsWith(TARO_ENABLER_PREFIX),
    ),
  };
};

const buildEmptyProjectAnalysisResult = (
  errors: ReadonlyArray<ProjectAnalysisError>,
  elapsedMs: number,
): ProjectAnalysisInternalResult => ({
  unusedFiles: [],
  verifiedUnusedFiles: [],
  unusedExports: [],
  unusedDependencies: [],
  skippedDependencies: [],
  circularDependencies: [],
  analysisErrors: errors,
  totalFiles: 0,
  totalExports: 0,
  analysisTimeMs: elapsedMs,
});

const validateConfig = (config: ProjectAnalysisConfig): ProjectAnalysisError | undefined => {
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

const analyzeProjectConfig = async (
  config: ProjectAnalysisConfig,
): Promise<ProjectAnalysisInternalResult> => {
  const pipelineStartTime = performance.now();
  const setupErrors: ProjectAnalysisError[] = [];

  const configValidationError = validateConfig(config);
  if (configValidationError) {
    return buildEmptyProjectAnalysisResult(
      [configValidationError],
      performance.now() - pipelineStartTime,
    );
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

  const entriesPromise = resolveEntries(configWithExclusions).catch(
    (entriesError: unknown): Awaited<ReturnType<typeof resolveEntries>> => {
      setupErrors.push(
        new WorkspaceError({
          code: "workspace-discovery-failed",
          message: "resolveEntries failed — defaulting to empty entry set",
          path: config.rootDir,
          detail: describeUnknownError(entriesError),
        }),
      );
      return {
        productionEntries: [],
        authoritativeProductionEntries: [],
        explicitProductionEntries: [],
        testEntries: [],
        alwaysUsedFiles: [],
        externallyConsumedFiles: [],
        analysisExcludedFiles: [],
      };
    },
  );

  let files: Awaited<ReturnType<typeof collectSourceFiles>>;
  try {
    files = await collectSourceFiles(configWithExclusions);
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
    return buildEmptyProjectAnalysisResult(setupErrors, performance.now() - pipelineStartTime);
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

  const platformCapabilityRoots: PlatformCapabilityRoot[] = [
    absoluteRoot,
    ...workspacePackages.map((workspacePackage) => workspacePackage.directory),
  ]
    .map((directory) => {
      try {
        return { directory, ...detectPlatformCapabilities(directory) };
      } catch {
        return { directory, hasReactNative: false, hasTaro: false };
      }
    })
    .sort((leftRoot, rightRoot) => rightRoot.directory.length - leftRoot.directory.length);
  const hasReactNativePackage = platformCapabilityRoots.some(
    (capabilityRoot) => capabilityRoot.hasReactNative,
  );

  let moduleResolver: ReturnType<typeof createResolver>;
  try {
    moduleResolver = createResolver(
      config,
      workspacePackages.map((workspacePackage) => ({
        name: workspacePackage.name,
        directory: workspacePackage.directory,
      })),
      { hasReactNative: hasReactNativePackage, monorepoRoot },
    );
  } catch (resolverError) {
    setupErrors.push(
      new ResolverError({
        message: "createResolver failed",
        path: config.rootDir,
        detail: describeUnknownError(resolverError),
      }),
    );
    return buildEmptyProjectAnalysisResult(setupErrors, performance.now() - pipelineStartTime);
  }
  const parsedModules = files.map((file) => parseSourceFile(file.path));
  const autoImportReferencesByModuleIndex = collectUnpluginAutoImportReferences(
    absoluteRoot,
    files,
  );
  for (const [moduleIndex, autoImportReferences] of autoImportReferencesByModuleIndex) {
    parsedModules[moduleIndex].imports.push(...autoImportReferences);
  }

  const discoveredEntries = await entriesPromise;
  const buildScriptConsumedFiles = extractBuildScriptConsumedFiles(absoluteRoot);
  const relativeFilePaths = files.map((file) => toPosixPath(relative(absoluteRoot, file.path)));
  const linguistIgnoredPaths = collectGitLinguistIgnoredPaths(absoluteRoot, relativeFilePaths);
  const analysisExcludedFiles = new Set(discoveredEntries.analysisExcludedFiles);
  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    if (linguistIgnoredPaths.has(relativeFilePaths[fileIndex])) {
      analysisExcludedFiles.add(files[fileIndex].path);
    }
  }
  const moduleLinkInputsResult = buildModuleLinkInputs({
    projectRootDirectories: [
      absoluteRoot,
      ...workspacePackages.map((workspacePackage) => workspacePackage.directory),
    ],
    files,
    parsedModules,
    resolvedEntries: {
      ...discoveredEntries,
      alwaysUsedFiles: [...discoveredEntries.alwaysUsedFiles, ...buildScriptConsumedFiles],
      analysisExcludedFiles: [...analysisExcludedFiles],
    },
    gitIgnoredFilePaths: gitIgnoredFileSet,
    resolveModule: moduleResolver.resolveModule,
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
    return buildEmptyProjectAnalysisResult(setupErrors, performance.now() - pipelineStartTime);
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

  let platformSiblingIndex = new Map<number, number[]>();
  try {
    platformSiblingIndex = buildPlatformSiblingIndex(moduleGraph, (filePath) => {
      const containingCapabilityRoots = platformCapabilityRoots.filter((capabilityRoot) =>
        isPathInsideDirectoryOrEqual(filePath, capabilityRoot.directory),
      );
      return [
        ...(containingCapabilityRoots.some((capabilityRoot) => capabilityRoot.hasReactNative)
          ? REACT_NATIVE_ADDITIONAL_PLATFORM_SUFFIXES
          : []),
        ...(containingCapabilityRoots.some((capabilityRoot) => capabilityRoot.hasTaro)
          ? TARO_PLATFORM_SUFFIXES
          : []),
      ];
    });
    traceReachability(moduleGraph, platformSiblingIndex);
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

  markCompletePackageGraphs({
    graph: moduleGraph,
    packageRootDirectories: [
      absoluteRoot,
      ...workspacePackages.map((workspacePackage) => workspacePackage.directory),
    ],
    resolvedLocalImportSpecifiersByFilePath:
      moduleLinkInputsResult.resolvedLocalImportSpecifiersByFilePath,
    unresolvedImportingFilePaths: moduleLinkInputsResult.unresolvedImportingFilePaths,
    setupErrors,
  });

  const runReportDetector = <Result>(
    detectorName: string,
    detector: () => Result,
    fallback: Result,
  ): Result =>
    runSafeDetector({
      detectorName,
      detector,
      fallback,
      errorSink: setupErrors,
      module: "report",
      contextDescription: "while building project findings",
    });
  const unusedFiles = runReportDetector(
    "detectOrphanFiles",
    () => detectOrphanFiles(moduleGraph),
    [],
  );
  const verifiedUnusedFiles = runReportDetector(
    "detectVerifiedOrphanFiles",
    () => detectOrphanFiles(moduleGraph, { requireCompletePackageGraph: true }),
    [],
  );
  const unusedExports = runReportDetector(
    "detectDeadExports",
    () => detectDeadExports(moduleGraph, config, platformSiblingIndex),
    [],
  );
  const stalePackageReport = runReportDetector(
    "detectStalePackages",
    () => detectStalePackages(moduleGraph, config),
    { unusedDependencies: [], skippedDependencies: [] },
  );
  const circularDependencies = runReportDetector(
    "detectCycles",
    () => detectCycles(moduleGraph),
    [],
  );
  const analysisResult: ProjectAnalysisInternalResult = {
    unusedFiles,
    verifiedUnusedFiles,
    unusedExports,
    unusedDependencies: stalePackageReport.unusedDependencies,
    skippedDependencies: stalePackageReport.skippedDependencies,
    circularDependencies,
    analysisErrors: setupErrors,
    totalFiles: moduleGraph.modules.length,
    totalExports: moduleGraph.modules.reduce(
      (exportCount, module) =>
        exportCount +
        module.exports.filter(
          (exportInfo) => !(exportInfo.name === "*" && exportInfo.isNamespaceReExport),
        ).length,
      0,
    ),
    analysisTimeMs: performance.now() - pipelineStartTime,
  };

  return analysisResult;
};

const defineAnalyzeProjectConfig = (input: AnalyzeProjectInput): ProjectAnalysisConfig =>
  defineProjectAnalysisConfig({
    rootDir: input.rootDirectory,
    entryPatterns: input.entryPatterns === undefined ? undefined : [...input.entryPatterns],
    ignorePatterns: input.ignorePatterns === undefined ? undefined : [...input.ignorePatterns],
    tsConfigPath: input.tsConfigPath,
    reportTypes: true,
  });

const toPublicProjectAnalysisResult = (
  result: ProjectAnalysisInternalResult,
): ProjectAnalysisResult => ({
  unusedFiles: result.unusedFiles,
  unusedExports: result.unusedExports,
  unusedDependencies: result.unusedDependencies,
  circularDependencies: result.circularDependencies,
  analysisErrors: result.analysisErrors,
  totalFiles: result.totalFiles,
  totalExports: result.totalExports,
  analysisTimeMs: result.analysisTimeMs,
});

const toWorkerProjectAnalysisResult = (
  result: ProjectAnalysisInternalResult,
): ProjectAnalysisWorkerResult => ({
  unusedFiles: result.verifiedUnusedFiles,
  unusedExports: result.unusedExports,
  unusedDependencies: result.unusedDependencies,
  skippedDependencies: result.skippedDependencies,
  circularDependencies: result.circularDependencies,
  analysisErrors: result.analysisErrors,
  totalFiles: result.totalFiles,
  totalExports: result.totalExports,
  analysisTimeMs: result.analysisTimeMs,
});

export const analyzeProject = async (input: AnalyzeProjectInput): Promise<ProjectAnalysisResult> =>
  toPublicProjectAnalysisResult(await analyzeProjectConfig(defineAnalyzeProjectConfig(input)));

export const analyzeProjectForWorker = (
  input: AnalyzeProjectInput,
): Promise<ProjectAnalysisWorkerResult> =>
  analyzeProjectConfig(defineAnalyzeProjectConfig(input)).then(toWorkerProjectAnalysisResult);
