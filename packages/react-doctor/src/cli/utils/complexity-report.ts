import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type {
  ChangeComplexityFunctionEntry,
  EsTreeNode,
  FileComplexity,
  FunctionComplexity,
} from "oxlint-plugin-react-doctor";
import { listSourceFiles, toRelativePath, type MaterializedTree } from "@react-doctor/core";
import {
  calculateBloatRatio,
  calculateChangeComplexityScore,
  calculateChangeEntropy,
  calculateRawLinesChanged,
  calculateSubtreeDeleteCost,
  calculateSubtreeInsertCost,
  calculateWeightedTreeEditDistance,
} from "oxlint-plugin-react-doctor";
import {
  CHANGE_COMPLEXITY_ENTROPY_WEIGHT,
  CHANGE_COMPLEXITY_STRUCTURAL_RISK_WEIGHT,
} from "../../../../oxlint-plugin-react-doctor/src/plugin/semantic/constants.js";
import { COMPLEXITY_FILES_TEMP_DIR_PREFIX } from "./constants.js";
import { materializeBaselineFiles } from "./materialize-baseline-files.js";
import { resolveGitRefSha } from "./resolve-git-ref-sha.js";
import { VERSION } from "./version.js";

export type ComplexitySortMetric = "cyclomatic" | "cognitive";

export interface ComplexityFunctionEntry extends FunctionComplexity {
  readonly filePath: string;
  readonly relativePath: string;
  readonly key: string;
}

export interface ComplexityFileEntry {
  readonly filePath: string;
  readonly relativePath: string;
  readonly functionCount: number;
  readonly totalCyclomatic: number;
  readonly totalCognitive: number;
}

export interface ComplexityFunctionDelta {
  readonly key: string;
  readonly filePath: string;
  readonly relativePath: string;
  readonly name: string;
  readonly kind: FunctionComplexity["kind"];
  readonly line: number;
  readonly cyclomaticDelta: number;
  readonly cognitiveDelta: number;
  readonly nestingDelta: number;
  readonly essentialChange: number;
  readonly essentialChangeApproximate: boolean;
  readonly rawLinesChanged: number | null;
  readonly bloatRatio: number | null;
  readonly changeComplexity: number;
  readonly status: "added" | "removed" | "changed";
  readonly head: ComplexityFunctionEntry | null;
  readonly base: ComplexityFunctionEntry | null;
  readonly absoluteCyclomaticDelta: number;
}

export type ComplexityReportFunctionEntry = ComplexityFunctionEntry | ComplexityFunctionDelta;

export interface ComplexityDiffSummary {
  readonly baseRef: string;
  readonly computed: boolean;
  readonly note?: string;
  readonly functions: ReadonlyArray<ComplexityFunctionDelta>;
  readonly regressedCount: number;
  readonly improvedCount: number;
  readonly addedCount: number;
  readonly removedCount: number;
  readonly netCyclomaticChange: number;
  readonly netCognitiveChange: number;
  readonly totalEssentialChange: number;
  readonly totalStructuralRisk: number;
  readonly changeEntropy: number;
  readonly normalizedChangeEntropy: number;
  readonly changeComplexityScore: number;
}

export interface ComplexitySummary {
  readonly filesAnalyzed: number;
  readonly totalFunctions: number;
  readonly totalCyclomatic: number;
  readonly totalCognitive: number;
  readonly mostComplexFunction: ComplexityFunctionEntry | null;
}

export interface ComplexityReport {
  readonly version: string;
  readonly directory: string;
  readonly mode: "full" | "diff";
  readonly sortMetric: ComplexitySortMetric;
  readonly minCyclomatic: number;
  readonly top: number | null;
  readonly files: ComplexityFileEntry[];
  readonly functions: ComplexityReportFunctionEntry[];
  readonly diff?: ComplexityDiffSummary;
  readonly summary: ComplexitySummary;
}

export interface BuildComplexityReportInput {
  readonly directory: string;
  readonly diffRef?: string | null;
  readonly sortMetric?: ComplexitySortMetric;
  readonly minCyclomatic?: number;
  readonly top?: number | null;
}

interface ParsedComplexityFile {
  readonly filePath: string;
  readonly relativePath: string;
  readonly parsedFile: FileComplexity;
  readonly analysisFunctions: ChangeComplexityFunctionEntry[];
}

interface ComplexityTreeAnalysis {
  readonly files: ComplexityFileEntry[];
  readonly functions: ComplexityAnalysisFunctionEntry[];
  readonly totalCyclomatic: number;
  readonly totalCognitive: number;
}

interface ComplexityAnalysisFunctionEntry extends ComplexityFunctionEntry {
  readonly node: EsTreeNode;
  readonly sourceText: string;
  readonly startOffset: number;
  readonly endOffset: number;
}

interface ComplexityRuntimeTools {
  readonly parseSourceFile: (absoluteFilePath: string) => EsTreeNode | null;
  readonly analyzeComplexity: (program: EsTreeNode, sourceText: string) => FileComplexity;
  readonly collectChangeComplexityFunctionEntries: (
    program: EsTreeNode,
    sourceText: string,
    relativePath: string,
  ) => ChangeComplexityFunctionEntry[];
}

let complexityRuntimeToolsPromise: Promise<ComplexityRuntimeTools> | null = null;

const loadComplexityRuntimeTools = async (): Promise<ComplexityRuntimeTools> => {
  if (complexityRuntimeToolsPromise === null) {
    complexityRuntimeToolsPromise = import("oxlint-plugin-react-doctor").then(
      ({
        analyzeComplexity,
        collectChangeComplexityFunctionEntries,
        parseSourceFile,
      }): ComplexityRuntimeTools => ({
        analyzeComplexity,
        collectChangeComplexityFunctionEntries,
        parseSourceFile,
      }),
    );
  }

  return complexityRuntimeToolsPromise;
};

const DEFAULT_SORT_METRIC: ComplexitySortMetric = "cyclomatic";

const getKindPriority = (kind: FunctionComplexity["kind"]): number => {
  if (kind === "module") return 5;
  if (kind === "function") return 4;
  if (kind === "arrow") return 3;
  if (kind === "method") return 2;
  if (kind === "hook") return 1;
  return 0;
};

const compareFunctionsByDisplayPriority = (
  firstFunction: ComplexityFunctionEntry,
  secondFunction: ComplexityFunctionEntry,
  sortMetric: ComplexitySortMetric,
): number => {
  const metricDelta = secondFunction[sortMetric] - firstFunction[sortMetric];
  if (metricDelta !== 0) return metricDelta;

  const kindPriorityDelta =
    getKindPriority(firstFunction.kind) - getKindPriority(secondFunction.kind);
  if (kindPriorityDelta !== 0) return kindPriorityDelta;

  const nameDelta = firstFunction.name.localeCompare(secondFunction.name);
  if (nameDelta !== 0) return nameDelta;

  const pathDelta = firstFunction.relativePath.localeCompare(secondFunction.relativePath);
  if (pathDelta !== 0) return pathDelta;

  return firstFunction.line - secondFunction.line;
};

const getFunctionDeltaForSortMetric = (
  comparison: ComplexityFunctionDelta,
  sortMetric: ComplexitySortMetric,
): number => {
  if (sortMetric === "cognitive") return comparison.cognitiveDelta;
  return comparison.cyclomaticDelta;
};

const getAbsoluteFunctionDeltaForSortMetric = (
  comparison: ComplexityFunctionDelta,
  sortMetric: ComplexitySortMetric,
): number => Math.abs(getFunctionDeltaForSortMetric(comparison, sortMetric));

const getSignPriority = (delta: number): number => {
  if (delta > 0) return 2;
  if (delta < 0) return 0;
  return 1;
};

const compareFunctionDeltas = (
  firstDelta: ComplexityFunctionDelta,
  secondDelta: ComplexityFunctionDelta,
  sortMetric: ComplexitySortMetric,
): number => {
  const absoluteDelta =
    getAbsoluteFunctionDeltaForSortMetric(secondDelta, sortMetric) -
    getAbsoluteFunctionDeltaForSortMetric(firstDelta, sortMetric);
  if (absoluteDelta !== 0) return absoluteDelta;

  const signDelta =
    getSignPriority(getFunctionDeltaForSortMetric(secondDelta, sortMetric)) -
    getSignPriority(getFunctionDeltaForSortMetric(firstDelta, sortMetric));
  if (signDelta !== 0) return signDelta;

  const pathDelta = firstDelta.relativePath.localeCompare(secondDelta.relativePath);
  if (pathDelta !== 0) return pathDelta;

  const nameDelta = firstDelta.name.localeCompare(secondDelta.name);
  if (nameDelta !== 0) return nameDelta;

  return firstDelta.line - secondDelta.line;
};

const toPublicComplexityFunctionEntry = (
  functionEntry: ComplexityAnalysisFunctionEntry,
): ComplexityFunctionEntry => {
  const {
    node: _node,
    sourceText: _sourceText,
    startOffset: _startOffset,
    endOffset: _endOffset,
    ...publicEntry
  } = functionEntry;
  return publicEntry;
};

const parseComplexityFile = async (
  rootDirectory: string,
  relativePath: string,
): Promise<ParsedComplexityFile | null> => {
  const absolutePath = path.resolve(rootDirectory, relativePath);
  const { analyzeComplexity, collectChangeComplexityFunctionEntries, parseSourceFile } =
    await loadComplexityRuntimeTools();
  const sourceText = readFileSync(absolutePath, "utf8");
  const program = parseSourceFile(absolutePath);
  if (program === null) return null;
  const analysisFunctions = collectChangeComplexityFunctionEntries(
    program,
    sourceText,
    toRelativePath(absolutePath, rootDirectory),
  );

  return {
    filePath: absolutePath,
    relativePath: toRelativePath(absolutePath, rootDirectory),
    parsedFile: analyzeComplexity(program, sourceText),
    analysisFunctions,
  };
};

const flattenComplexityFile = (input: ParsedComplexityFile): ComplexityAnalysisFunctionEntry[] =>
  input.parsedFile.functions.map((functionEntry, index) => ({
    ...functionEntry,
    ...input.analysisFunctions[index]!,
    filePath: input.filePath,
    relativePath: input.relativePath,
    key: input.analysisFunctions[index]!.key,
  }));

const analyzeComplexityTree = async (directory: string): Promise<ComplexityTreeAnalysis> => {
  const sourceFiles = listSourceFiles(directory);
  const parsedFiles = (
    await Promise.all(
      sourceFiles.map(async (relativePath) => parseComplexityFile(directory, relativePath)),
    )
  ).filter((parsedFile): parsedFile is ParsedComplexityFile => parsedFile !== null);

  const files: ComplexityFileEntry[] = [];
  const functions: ComplexityAnalysisFunctionEntry[] = [];

  for (const parsedFile of parsedFiles) {
    const flattenedFunctions = flattenComplexityFile(parsedFile);
    functions.push(...flattenedFunctions);
    files.push({
      filePath: parsedFile.filePath,
      relativePath: parsedFile.relativePath,
      functionCount: flattenedFunctions.length,
      totalCyclomatic: parsedFile.parsedFile.totalCyclomatic,
      totalCognitive: parsedFile.parsedFile.totalCognitive,
    });
  }

  return {
    files,
    functions,
    totalCyclomatic: files.reduce((sum, fileEntry) => sum + fileEntry.totalCyclomatic, 0),
    totalCognitive: files.reduce((sum, fileEntry) => sum + fileEntry.totalCognitive, 0),
  };
};

const groupFunctionsByKey = (
  functions: ReadonlyArray<ComplexityAnalysisFunctionEntry>,
): Map<string, ComplexityAnalysisFunctionEntry[]> => {
  const groupedFunctions = new Map<string, ComplexityAnalysisFunctionEntry[]>();
  for (const functionEntry of [...functions].sort(
    (firstFunction, secondFunction) =>
      firstFunction.line - secondFunction.line || firstFunction.column - secondFunction.column,
  )) {
    const existingEntries = groupedFunctions.get(functionEntry.key);
    if (existingEntries === undefined) {
      groupedFunctions.set(functionEntry.key, [functionEntry]);
      continue;
    }
    existingEntries.push(functionEntry);
  }
  return groupedFunctions;
};

const compareFunctionAnalyses = (
  directory: string,
  headFunctions: ReadonlyArray<ComplexityAnalysisFunctionEntry>,
  baseFunctions: ReadonlyArray<ComplexityAnalysisFunctionEntry>,
  sortMetric: ComplexitySortMetric,
): ComplexityFunctionDelta[] => {
  const comparisonEntries: ComplexityFunctionDelta[] = [];
  const headFunctionsByKey = groupFunctionsByKey(headFunctions);
  const baseFunctionsByKey = groupFunctionsByKey(baseFunctions);
  const allKeys = new Set<string>([...headFunctionsByKey.keys(), ...baseFunctionsByKey.keys()]);

  for (const key of allKeys) {
    const headEntries = headFunctionsByKey.get(key) ?? [];
    const baseEntries = baseFunctionsByKey.get(key) ?? [];
    const sharedCount = Math.min(headEntries.length, baseEntries.length);

    for (let index = 0; index < sharedCount; index += 1) {
      const headEntry = headEntries[index]!;
      const baseEntry = baseEntries[index]!;
      const cyclomaticDelta = headEntry.cyclomatic - baseEntry.cyclomatic;
      const cognitiveDelta = headEntry.cognitive - baseEntry.cognitive;
      const nestingDelta = headEntry.maxNestingDepth - baseEntry.maxNestingDepth;
      const { essentialChange, approximate } = calculateWeightedTreeEditDistance(
        headEntry.node,
        baseEntry.node,
      );
      const rawLinesChanged = calculateRawLinesChanged(headEntry, baseEntry);
      if (
        cyclomaticDelta === 0 &&
        cognitiveDelta === 0 &&
        nestingDelta === 0 &&
        rawLinesChanged === 0 &&
        essentialChange === 0
      ) {
        continue;
      }
      const bloatRatio = calculateBloatRatio(rawLinesChanged, essentialChange);
      const changeComplexity = calculateChangeComplexityScore(
        essentialChange,
        cyclomaticDelta,
        cognitiveDelta,
        nestingDelta,
      );
      comparisonEntries.push({
        key,
        filePath: headEntry.filePath,
        relativePath: headEntry.relativePath,
        name: headEntry.name,
        kind: headEntry.kind,
        line: headEntry.line,
        cyclomaticDelta,
        cognitiveDelta,
        nestingDelta,
        essentialChange,
        essentialChangeApproximate: approximate,
        rawLinesChanged,
        bloatRatio,
        changeComplexity,
        status: "changed",
        head: toPublicComplexityFunctionEntry(headEntry),
        base: toPublicComplexityFunctionEntry(baseEntry),
        absoluteCyclomaticDelta: Math.abs(cyclomaticDelta),
      });
    }

    for (let index = sharedCount; index < headEntries.length; index += 1) {
      const headEntry = headEntries[index]!;
      const essentialChange = calculateSubtreeInsertCost(headEntry.node);
      const changeComplexity = calculateChangeComplexityScore(
        essentialChange,
        headEntry.cyclomatic,
        headEntry.cognitive,
        headEntry.maxNestingDepth,
      );
      comparisonEntries.push({
        key,
        filePath: headEntry.filePath,
        relativePath: headEntry.relativePath,
        name: headEntry.name,
        kind: headEntry.kind,
        line: headEntry.line,
        cyclomaticDelta: headEntry.cyclomatic,
        cognitiveDelta: headEntry.cognitive,
        nestingDelta: headEntry.maxNestingDepth,
        essentialChange,
        essentialChangeApproximate: false,
        rawLinesChanged: null,
        bloatRatio: null,
        changeComplexity,
        status: "added",
        head: toPublicComplexityFunctionEntry(headEntry),
        base: null,
        absoluteCyclomaticDelta: Math.abs(headEntry.cyclomatic),
      });
    }

    for (let index = sharedCount; index < baseEntries.length; index += 1) {
      const baseEntry = baseEntries[index]!;
      const essentialChange = calculateSubtreeDeleteCost(baseEntry.node);
      const changeComplexity = calculateChangeComplexityScore(
        essentialChange,
        -baseEntry.cyclomatic,
        -baseEntry.cognitive,
        -baseEntry.maxNestingDepth,
      );
      comparisonEntries.push({
        key,
        filePath: path.resolve(directory, baseEntry.relativePath),
        relativePath: baseEntry.relativePath,
        name: baseEntry.name,
        kind: baseEntry.kind,
        line: baseEntry.line,
        cyclomaticDelta: -baseEntry.cyclomatic,
        cognitiveDelta: -baseEntry.cognitive,
        nestingDelta: -baseEntry.maxNestingDepth,
        essentialChange,
        essentialChangeApproximate: false,
        rawLinesChanged: null,
        bloatRatio: null,
        changeComplexity,
        status: "removed",
        head: null,
        base: toPublicComplexityFunctionEntry(baseEntry),
        absoluteCyclomaticDelta: Math.abs(baseEntry.cyclomatic),
      });
    }
  }

  return comparisonEntries.sort((firstDelta, secondDelta) =>
    compareFunctionDeltas(firstDelta, secondDelta, sortMetric),
  );
};

const summarizeComparison = (
  functions: ReadonlyArray<ComplexityFunctionDelta>,
): Omit<ComplexityDiffSummary, "baseRef" | "computed" | "note"> => {
  let regressedCount = 0;
  let improvedCount = 0;
  let addedCount = 0;
  let removedCount = 0;
  let netCyclomaticChange = 0;
  let netCognitiveChange = 0;
  let totalEssentialChange = 0;
  let totalStructuralRisk = 0;

  for (const functionDelta of functions) {
    netCyclomaticChange += functionDelta.cyclomaticDelta;
    netCognitiveChange += functionDelta.cognitiveDelta;
    totalEssentialChange += functionDelta.essentialChange;
    totalStructuralRisk += functionDelta.changeComplexity - functionDelta.essentialChange;
    if (functionDelta.status === "added") {
      addedCount += 1;
    } else if (functionDelta.status === "removed") {
      removedCount += 1;
    } else if (
      functionDelta.cyclomaticDelta > 0 ||
      (functionDelta.cyclomaticDelta === 0 && functionDelta.cognitiveDelta > 0)
    ) {
      regressedCount += 1;
    } else if (
      functionDelta.cyclomaticDelta < 0 ||
      (functionDelta.cyclomaticDelta === 0 && functionDelta.cognitiveDelta < 0)
    ) {
      improvedCount += 1;
    }
  }

  const changeEntropy = calculateChangeEntropy(
    functions.map((functionDelta) => functionDelta.essentialChange),
  );
  return {
    functions,
    regressedCount,
    improvedCount,
    addedCount,
    removedCount,
    netCyclomaticChange,
    netCognitiveChange,
    totalEssentialChange,
    totalStructuralRisk,
    changeEntropy: changeEntropy.changeEntropy,
    normalizedChangeEntropy: changeEntropy.normalizedChangeEntropy,
    changeComplexityScore:
      totalEssentialChange +
      totalStructuralRisk * CHANGE_COMPLEXITY_STRUCTURAL_RISK_WEIGHT +
      changeEntropy.normalizedChangeEntropy * CHANGE_COMPLEXITY_ENTROPY_WEIGHT,
  };
};

const createEmptyDiffSummary = (
  functions: ReadonlyArray<ComplexityFunctionDelta>,
): Omit<ComplexityDiffSummary, "baseRef" | "computed" | "note"> => ({
  functions,
  regressedCount: 0,
  improvedCount: 0,
  addedCount: 0,
  removedCount: 0,
  netCyclomaticChange: 0,
  netCognitiveChange: 0,
  totalEssentialChange: 0,
  totalStructuralRisk: 0,
  changeEntropy: 0,
  normalizedChangeEntropy: 0,
  changeComplexityScore: 0,
});

const buildComplexitySummary = (
  analysis: ComplexityTreeAnalysis,
  mostComplexFunction: ComplexityFunctionEntry | null,
): ComplexitySummary => ({
  filesAnalyzed: analysis.files.length,
  totalFunctions: analysis.functions.length,
  totalCyclomatic: analysis.totalCyclomatic,
  totalCognitive: analysis.totalCognitive,
  mostComplexFunction,
});

const materializeBaselineTree = async (
  directory: string,
  baseRef: string,
  files: ReadonlyArray<string>,
): Promise<MaterializedTree> => {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), COMPLEXITY_FILES_TEMP_DIR_PREFIX));
  try {
    return await materializeBaselineFiles({
      directory,
      ref: baseRef,
      files,
      tempDirectory,
    });
  } catch (error) {
    rmSync(tempDirectory, { recursive: true, force: true });
    throw error;
  }
};

export const buildComplexityReport = async (
  input: BuildComplexityReportInput,
): Promise<ComplexityReport> => {
  const resolvedDirectory = path.resolve(input.directory);
  const sortMetric = input.sortMetric ?? DEFAULT_SORT_METRIC;
  const minCyclomatic = input.minCyclomatic ?? 1;
  const top = input.top ?? null;
  const requestedDiffRef = input.diffRef ?? null;

  const headAnalysis = await analyzeComplexityTree(resolvedDirectory);
  const publicHeadFunctions = headAnalysis.functions.map(toPublicComplexityFunctionEntry);
  const rankedHeadFunctions = publicHeadFunctions
    .filter((functionEntry) => functionEntry.cyclomatic >= minCyclomatic)
    .sort((firstFunction, secondFunction) =>
      compareFunctionsByDisplayPriority(firstFunction, secondFunction, sortMetric),
    );
  const summary = buildComplexitySummary(headAnalysis, rankedHeadFunctions[0] ?? null);

  if (requestedDiffRef === null) {
    return {
      version: VERSION,
      directory: resolvedDirectory,
      mode: "full",
      sortMetric,
      minCyclomatic,
      top,
      files: headAnalysis.files,
      functions: rankedHeadFunctions,
      summary,
    };
  }

  const resolvedDiffRef = resolveGitRefSha(resolvedDirectory, requestedDiffRef);
  if (resolvedDiffRef === null) {
    return {
      version: VERSION,
      directory: resolvedDirectory,
      mode: "diff",
      sortMetric,
      minCyclomatic,
      top,
      files: headAnalysis.files,
      functions: rankedHeadFunctions,
      diff: {
        baseRef: requestedDiffRef,
        computed: false,
        note: `Could not compute diff against ${requestedDiffRef}; showing head-only complexity.`,
        ...createEmptyDiffSummary([]),
      },
      summary,
    };
  }

  const sourceFiles = listSourceFiles(resolvedDirectory);
  try {
    const snapshot = await materializeBaselineTree(resolvedDirectory, resolvedDiffRef, sourceFiles);
    try {
      const baseAnalysis = await analyzeComplexityTree(snapshot.tempDirectory);
      const diffFunctions = compareFunctionAnalyses(
        resolvedDirectory,
        headAnalysis.functions,
        baseAnalysis.functions,
        sortMetric,
      );
      const visibleDiffFunctions = diffFunctions.filter(
        (comparison) => getComplexityComparisonCyclomatic(comparison) >= minCyclomatic,
      );
      const diffSummary = summarizeComparison(visibleDiffFunctions);
      return {
        version: VERSION,
        directory: resolvedDirectory,
        mode: "diff",
        sortMetric,
        minCyclomatic,
        top,
        files: headAnalysis.files,
        functions: visibleDiffFunctions,
        diff: {
          baseRef: resolvedDiffRef,
          computed: true,
          ...diffSummary,
        },
        summary,
      };
    } finally {
      snapshot.cleanup();
    }
  } catch {
    return {
      version: VERSION,
      directory: resolvedDirectory,
      mode: "diff",
      sortMetric,
      minCyclomatic,
      top,
      files: headAnalysis.files,
      functions: rankedHeadFunctions,
      diff: {
        baseRef: resolvedDiffRef,
        computed: false,
        note: `Could not compute diff against ${requestedDiffRef}; showing head-only complexity.`,
        ...createEmptyDiffSummary([]),
      },
      summary,
    };
  }
};

export const getVisibleComplexityFunctions = (
  functions: ReadonlyArray<ComplexityAnalysisFunctionEntry>,
  minCyclomatic: number,
  sortMetric: ComplexitySortMetric,
  top: number | null,
): ComplexityFunctionEntry[] => {
  const visibleFunctions = functions
    .filter((functionEntry) => functionEntry.cyclomatic >= minCyclomatic)
    .slice()
    .sort((firstFunction, secondFunction) =>
      compareFunctionsByDisplayPriority(firstFunction, secondFunction, sortMetric),
    );
  return top === null ? visibleFunctions : visibleFunctions.slice(0, top);
};

export const formatComplexityFunctionLocation = (functionEntry: ComplexityFunctionEntry): string =>
  `${functionEntry.relativePath}:${functionEntry.line}`;

export const getComplexityComparisonDisplayFunction = (
  comparison: ComplexityFunctionDelta,
): ComplexityFunctionEntry | null => comparison.head ?? comparison.base;

export const getComplexityComparisonCyclomatic = (comparison: ComplexityFunctionDelta): number =>
  comparison.head?.cyclomatic ?? comparison.base?.cyclomatic ?? 0;

export const getComplexityComparisonNesting = (comparison: ComplexityFunctionDelta): number =>
  comparison.head?.maxNestingDepth ?? comparison.base?.maxNestingDepth ?? 0;

export const formatComplexityComparisonLocation = (comparison: ComplexityFunctionDelta): string => {
  const displayFunction = getComplexityComparisonDisplayFunction(comparison);
  return displayFunction === null ? "<unknown>" : formatComplexityFunctionLocation(displayFunction);
};

export const formatComplexityKindLabel = (kind: FunctionComplexity["kind"]): string => {
  if (kind === "module") return "module";
  return kind;
};

export const formatComplexityDelta = (delta: number): string =>
  delta > 0 ? `+${delta}` : `${delta}`;

export const isComplexityFunctionEntry = (
  entry: ComplexityReportFunctionEntry,
): entry is ComplexityFunctionEntry => "maxNestingDepth" in entry;
