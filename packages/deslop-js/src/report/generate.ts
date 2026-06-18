import type { DeslopConfig, DependencyGraph, DeslopError, ScanResult } from "../types.js";
import { detectOrphanFiles } from "./files.js";
import { detectDeadExports } from "./exports.js";
import { detectStalePackages } from "./packages.js";
import { detectCycles } from "./cycles.js";
import {
  detectRedundantAliases,
  detectDuplicateExports,
  detectUselessAliasedReExports,
} from "./redundancy.js";
import {
  detectDuplicateImports,
  detectRedundantTypePatterns,
  detectIdentityWrappers,
  detectDuplicateTypeDefinitions,
  detectDuplicateInlineTypes,
  detectSimplifiableFunctions,
  detectSimplifiableExpressions,
  detectDuplicateConstants,
} from "./dry-patterns.js";
import { detectCrossFileDuplicateExports } from "./cross-file-duplicate-exports.js";
import { detectDuplicateBlocks } from "../duplicate-blocks/index.js";
import { detectReExportCycles } from "./re-export-cycles.js";
import { correlateFlagsWithDeadCode, detectFeatureFlags } from "./feature-flags.js";
import { detectComplexHotspots } from "./complexity.js";
import { detectPrivateTypeLeaks } from "./private-type-leaks.js";
import { detectTypeScriptSmells } from "./typescript-smells.js";
import { runSemanticAnalysis } from "../semantic/index.js";
import { DetectorError, describeUnknownError } from "../errors.js";
import { MAX_ANALYSIS_ERRORS } from "../constants.js";
import { runSafeDetector } from "../utils/run-safe-detector.js";

const safeReportDetector = <ResultType>(
  detectorName: string,
  detector: () => ResultType,
  fallback: ResultType,
  errorSink: DeslopError[],
): ResultType =>
  runSafeDetector({
    detectorName,
    detector,
    fallback,
    errorSink,
    module: "report",
    contextDescription: "while building findings",
  });

export const generateReport = (graph: DependencyGraph, config: DeslopConfig): ScanResult => {
  const analysisStartTime = performance.now();
  const errorSink: DeslopError[] = [];

  for (const module of graph.modules) {
    for (const parseError of module.parseErrors) {
      if (errorSink.length >= MAX_ANALYSIS_ERRORS) break;
      errorSink.push(parseError);
    }
    if (errorSink.length >= MAX_ANALYSIS_ERRORS) break;
  }

  const unusedFiles = safeReportDetector(
    "detectOrphanFiles",
    () => detectOrphanFiles(graph),
    [],
    errorSink,
  );
  const unusedExports = safeReportDetector(
    "detectDeadExports",
    () => detectDeadExports(graph, config),
    [],
    errorSink,
  );
  const unusedDependencies = safeReportDetector(
    "detectStalePackages",
    () => detectStalePackages(graph, config),
    [],
    errorSink,
  );
  const circularDependencies = safeReportDetector(
    "detectCycles",
    () => detectCycles(graph),
    [],
    errorSink,
  );
  const syntacticRedundantAliases = config.reportRedundancy
    ? [
        ...safeReportDetector(
          "detectRedundantAliases",
          () => detectRedundantAliases(graph),
          [],
          errorSink,
        ),
        ...safeReportDetector(
          "detectUselessAliasedReExports",
          () => detectUselessAliasedReExports(graph),
          [],
          errorSink,
        ),
      ]
    : [];
  const duplicateExports = config.reportRedundancy
    ? safeReportDetector(
        "detectDuplicateExports",
        () => detectDuplicateExports(graph),
        [],
        errorSink,
      )
    : [];
  const duplicateImports = config.reportRedundancy
    ? safeReportDetector(
        "detectDuplicateImports",
        () => detectDuplicateImports(graph),
        [],
        errorSink,
      )
    : [];
  const redundantTypePatterns = config.reportRedundancy
    ? safeReportDetector(
        "detectRedundantTypePatterns",
        () => detectRedundantTypePatterns(graph),
        [],
        errorSink,
      )
    : [];
  const identityWrappers = config.reportRedundancy
    ? safeReportDetector(
        "detectIdentityWrappers",
        () => detectIdentityWrappers(graph),
        [],
        errorSink,
      )
    : [];
  const duplicateTypeDefinitions = config.reportRedundancy
    ? safeReportDetector(
        "detectDuplicateTypeDefinitions",
        () => detectDuplicateTypeDefinitions(graph),
        [],
        errorSink,
      )
    : [];
  const duplicateInlineTypes = config.reportRedundancy
    ? safeReportDetector(
        "detectDuplicateInlineTypes",
        () => detectDuplicateInlineTypes(graph),
        [],
        errorSink,
      )
    : [];
  const simplifiableFunctions = config.reportRedundancy
    ? safeReportDetector(
        "detectSimplifiableFunctions",
        () => detectSimplifiableFunctions(graph),
        [],
        errorSink,
      )
    : [];
  const simplifiableExpressions = config.reportRedundancy
    ? safeReportDetector(
        "detectSimplifiableExpressions",
        () => detectSimplifiableExpressions(graph),
        [],
        errorSink,
      )
    : [];
  const duplicateConstants = config.reportRedundancy
    ? safeReportDetector(
        "detectDuplicateConstants",
        () => detectDuplicateConstants(graph),
        [],
        errorSink,
      )
    : [];
  const crossFileDuplicateExports = config.reportRedundancy
    ? safeReportDetector(
        "detectCrossFileDuplicateExports",
        () => detectCrossFileDuplicateExports(graph),
        [],
        errorSink,
      )
    : [];
  const duplicateBlockResult = safeReportDetector(
    "detectDuplicateBlocks",
    () => detectDuplicateBlocks(graph, config.duplicateBlocks, config.rootDir),
    { duplicateBlocks: [], duplicateBlockClusters: [], shadowedDirectoryPairs: [] },
    errorSink,
  );

  const reExportCycles = safeReportDetector(
    "detectReExportCycles",
    () => detectReExportCycles(graph),
    [],
    errorSink,
  );
  const featureFlags = safeReportDetector(
    "detectFeatureFlags",
    () => detectFeatureFlags(graph, config.featureFlags),
    [],
    errorSink,
  );
  const complexFunctions = safeReportDetector(
    "detectComplexHotspots",
    () => detectComplexHotspots(graph, config.complexity),
    [],
    errorSink,
  );
  const privateTypeLeaks = safeReportDetector(
    "detectPrivateTypeLeaks",
    () => detectPrivateTypeLeaks(graph),
    [],
    errorSink,
  );
  const typeScriptSmellsResult = safeReportDetector(
    "detectTypeScriptSmells",
    () => detectTypeScriptSmells(graph),
    {
      unnecessaryAssertions: [],
      lazyImportsAtTopLevel: [],
      commonjsInEsm: [],
      typeScriptEscapeHatches: [],
    },
    errorSink,
  );
  let semanticResult: ReturnType<typeof runSemanticAnalysis>;
  try {
    semanticResult = runSemanticAnalysis(graph, config);
  } catch (semanticError) {
    errorSink.push(
      new DetectorError({
        module: "semantic",
        message: "runSemanticAnalysis threw at the top level",
        detail: describeUnknownError(semanticError),
      }),
    );
    semanticResult = {
      unusedTypes: [],
      unusedEnumMembers: [],
      unusedClassMembers: [],
      misclassifiedDependencies: [],
      redundantAliases: [],
      errors: [],
      contextStatus: "typescript-load-failed",
    };
  }
  for (const semanticError of semanticResult.errors) {
    if (errorSink.length >= MAX_ANALYSIS_ERRORS) break;
    errorSink.push(semanticError);
  }

  const redundantAliases = config.reportRedundancy
    ? [...syntacticRedundantAliases, ...semanticResult.redundantAliases]
    : [];

  if (featureFlags.length > 0) {
    correlateFlagsWithDeadCode(featureFlags, { unusedExports });
  }
  const totalExports = graph.modules.reduce(
    (exportCount, module) =>
      exportCount +
      module.exports.filter(
        (exportInfo) => !(exportInfo.name === "*" && exportInfo.isNamespaceReExport),
      ).length,
    0,
  );

  return {
    unusedFiles,
    unusedExports,
    unusedDependencies,
    circularDependencies,
    unusedTypes: semanticResult.unusedTypes,
    misclassifiedDependencies: semanticResult.misclassifiedDependencies,
    unusedEnumMembers: semanticResult.unusedEnumMembers,
    unusedClassMembers: semanticResult.unusedClassMembers,
    redundantAliases,
    duplicateExports,
    duplicateImports,
    redundantTypePatterns,
    identityWrappers,
    duplicateTypeDefinitions,
    duplicateInlineTypes,
    simplifiableFunctions,
    simplifiableExpressions,
    duplicateConstants,
    crossFileDuplicateExports,
    duplicateBlocks: duplicateBlockResult.duplicateBlocks,
    duplicateBlockClusters: duplicateBlockResult.duplicateBlockClusters,
    shadowedDirectoryPairs: duplicateBlockResult.shadowedDirectoryPairs,
    reExportCycles,
    featureFlags,
    complexFunctions,
    privateTypeLeaks,
    unnecessaryAssertions: typeScriptSmellsResult.unnecessaryAssertions,
    lazyImportsAtTopLevel: typeScriptSmellsResult.lazyImportsAtTopLevel,
    commonjsInEsm: typeScriptSmellsResult.commonjsInEsm,
    typeScriptEscapeHatches: typeScriptSmellsResult.typeScriptEscapeHatches,
    analysisErrors: errorSink,
    totalFiles: graph.modules.length,
    totalExports,
    analysisTimeMs: performance.now() - analysisStartTime,
  };
};
