import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { EsTreeNode, FileComplexity, FunctionComplexity } from "oxlint-plugin-react-doctor";
import { listSourceFiles, type MaterializedTree } from "@react-doctor/core";
import { COMPLEXITY_FILES_TEMP_DIR_PREFIX } from "./constants.js";
import { materializeBaselineFiles } from "./materialize-baseline-files.js";
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
}

interface ComplexityTreeAnalysis {
  readonly files: ComplexityFileEntry[];
  readonly functions: ComplexityFunctionEntry[];
  readonly totalCyclomatic: number;
  readonly totalCognitive: number;
}

interface ComplexityRuntimeTools {
  readonly parseSourceFile: (absoluteFilePath: string) => EsTreeNode | null;
  readonly analyzeComplexity: (program: EsTreeNode, sourceText: string) => FileComplexity;
}

let complexityRuntimeToolsPromise: Promise<ComplexityRuntimeTools> | null = null;

const loadComplexityRuntimeTools = async (): Promise<ComplexityRuntimeTools> => {
  if (complexityRuntimeToolsPromise === null) {
    complexityRuntimeToolsPromise = import("oxlint-plugin-react-doctor").then(
      ({ analyzeComplexity, parseSourceFile }) => ({
        analyzeComplexity,
        parseSourceFile,
      }),
    );
  }

  return complexityRuntimeToolsPromise;
};

interface ComplexityFunctionKeyInput {
  readonly relativePath: string;
  readonly name: string;
  readonly kind: FunctionComplexity["kind"];
  readonly line: number;
}

const DEFAULT_SORT_METRIC: ComplexitySortMetric = "cyclomatic";

const buildFunctionKey = (input: ComplexityFunctionKeyInput): string => {
  if (input.name === "<module>") return `${input.relativePath}|module`;
  if (input.name === "<anonymous>") return `${input.relativePath}|${input.kind}|${input.line}`;
  return `${input.relativePath}|${input.kind}|${input.name}`;
};

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

const compareFunctionDeltas = (
  firstDelta: ComplexityFunctionDelta,
  secondDelta: ComplexityFunctionDelta,
): number => {
  const absoluteCyclomaticDelta =
    secondDelta.absoluteCyclomaticDelta - firstDelta.absoluteCyclomaticDelta;
  if (absoluteCyclomaticDelta !== 0) return absoluteCyclomaticDelta;

  const getSignPriority = (delta: number): number => {
    if (delta > 0) return 2;
    if (delta < 0) return 0;
    return 1;
  };
  const signDelta =
    getSignPriority(secondDelta.cyclomaticDelta) - getSignPriority(firstDelta.cyclomaticDelta);
  if (signDelta !== 0) return signDelta;

  const pathDelta = firstDelta.relativePath.localeCompare(secondDelta.relativePath);
  if (pathDelta !== 0) return pathDelta;

  const nameDelta = firstDelta.name.localeCompare(secondDelta.name);
  if (nameDelta !== 0) return nameDelta;

  return firstDelta.line - secondDelta.line;
};

const parseComplexityFile = async (
  rootDirectory: string,
  relativePath: string,
): Promise<ParsedComplexityFile | null> => {
  const absolutePath = path.resolve(rootDirectory, relativePath);
  const { analyzeComplexity, parseSourceFile } = await loadComplexityRuntimeTools();
  const sourceText = readFileSync(absolutePath, "utf8");
  const program = parseSourceFile(absolutePath);
  if (program === null) return null;

  return {
    filePath: absolutePath,
    relativePath,
    parsedFile: analyzeComplexity(program, sourceText),
  };
};

const flattenComplexityFile = (input: ParsedComplexityFile): ComplexityFunctionEntry[] =>
  input.parsedFile.functions.map((functionEntry) => ({
    ...functionEntry,
    filePath: input.filePath,
    relativePath: input.relativePath,
    key: buildFunctionKey({
      relativePath: input.relativePath,
      name: functionEntry.name,
      kind: functionEntry.kind,
      line: functionEntry.line,
    }),
  }));

const analyzeComplexityTree = async (directory: string): Promise<ComplexityTreeAnalysis> => {
  const sourceFiles = listSourceFiles(directory);
  const parsedFiles = (
    await Promise.all(
      sourceFiles.map(async (relativePath) => parseComplexityFile(directory, relativePath)),
    )
  ).filter((parsedFile): parsedFile is ParsedComplexityFile => parsedFile !== null);

  const files: ComplexityFileEntry[] = [];
  const functions: ComplexityFunctionEntry[] = [];

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
  functions: ReadonlyArray<ComplexityFunctionEntry>,
): Map<string, ComplexityFunctionEntry[]> => {
  const groupedFunctions = new Map<string, ComplexityFunctionEntry[]>();
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
  headFunctions: ReadonlyArray<ComplexityFunctionEntry>,
  baseFunctions: ReadonlyArray<ComplexityFunctionEntry>,
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
      if (cyclomaticDelta === 0 && cognitiveDelta === 0) continue;
      comparisonEntries.push({
        key,
        filePath: headEntry.filePath,
        relativePath: headEntry.relativePath,
        name: headEntry.name,
        kind: headEntry.kind,
        line: headEntry.line,
        cyclomaticDelta,
        cognitiveDelta,
        status: "changed",
        head: headEntry,
        base: baseEntry,
        absoluteCyclomaticDelta: Math.abs(cyclomaticDelta),
      });
    }

    for (let index = sharedCount; index < headEntries.length; index += 1) {
      const headEntry = headEntries[index]!;
      comparisonEntries.push({
        key,
        filePath: headEntry.filePath,
        relativePath: headEntry.relativePath,
        name: headEntry.name,
        kind: headEntry.kind,
        line: headEntry.line,
        cyclomaticDelta: headEntry.cyclomatic,
        cognitiveDelta: headEntry.cognitive,
        status: "added",
        head: headEntry,
        base: null,
        absoluteCyclomaticDelta: Math.abs(headEntry.cyclomatic),
      });
    }

    for (let index = sharedCount; index < baseEntries.length; index += 1) {
      const baseEntry = baseEntries[index]!;
      comparisonEntries.push({
        key,
        filePath: baseEntry.filePath,
        relativePath: baseEntry.relativePath,
        name: baseEntry.name,
        kind: baseEntry.kind,
        line: baseEntry.line,
        cyclomaticDelta: -baseEntry.cyclomatic,
        cognitiveDelta: -baseEntry.cognitive,
        status: "removed",
        head: null,
        base: baseEntry,
        absoluteCyclomaticDelta: Math.abs(baseEntry.cyclomatic),
      });
    }
  }

  return comparisonEntries.sort(compareFunctionDeltas);
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

  for (const functionDelta of functions) {
    netCyclomaticChange += functionDelta.cyclomaticDelta;
    netCognitiveChange += functionDelta.cognitiveDelta;
    if (functionDelta.status === "added") {
      addedCount += 1;
    } else if (functionDelta.status === "removed") {
      removedCount += 1;
    } else if (functionDelta.cyclomaticDelta > 0) {
      regressedCount += 1;
    } else if (functionDelta.cyclomaticDelta < 0) {
      improvedCount += 1;
    }
  }

  return {
    functions,
    regressedCount,
    improvedCount,
    addedCount,
    removedCount,
    netCyclomaticChange,
    netCognitiveChange,
  };
};

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

  const headAnalysis = await analyzeComplexityTree(resolvedDirectory);
  const rankedHeadFunctions = headAnalysis.functions
    .filter((functionEntry) => functionEntry.cyclomatic >= minCyclomatic)
    .sort((firstFunction, secondFunction) =>
      compareFunctionsByDisplayPriority(firstFunction, secondFunction, sortMetric),
    );
  const summary = buildComplexitySummary(headAnalysis, rankedHeadFunctions[0] ?? null);

  const baseRef = input.diffRef ?? null;
  if (baseRef === null) {
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

  const sourceFiles = listSourceFiles(resolvedDirectory);
  try {
    const snapshot = await materializeBaselineTree(resolvedDirectory, baseRef, sourceFiles);
    if (sourceFiles.length > 0 && snapshot.materializedFiles.length === 0) {
      snapshot.cleanup();
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
          baseRef,
          computed: false,
          note: `Could not compute diff against ${baseRef}; showing head-only complexity.`,
          functions: [],
          regressedCount: 0,
          improvedCount: 0,
          addedCount: 0,
          removedCount: 0,
          netCyclomaticChange: 0,
          netCognitiveChange: 0,
        },
        summary,
      };
    }
    try {
      const baseAnalysis = await analyzeComplexityTree(snapshot.tempDirectory);
      const diffFunctions = compareFunctionAnalyses(headAnalysis.functions, baseAnalysis.functions);
      const diffSummary = summarizeComparison(diffFunctions);
      return {
        version: VERSION,
        directory: resolvedDirectory,
        mode: "diff",
        sortMetric,
        minCyclomatic,
        top,
        files: headAnalysis.files,
        functions: diffFunctions,
        diff: {
          baseRef,
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
        baseRef,
        computed: false,
        note: `Could not compute diff against ${baseRef}; showing head-only complexity.`,
        functions: [],
        regressedCount: 0,
        improvedCount: 0,
        addedCount: 0,
        removedCount: 0,
        netCyclomaticChange: 0,
        netCognitiveChange: 0,
      },
      summary,
    };
  }
};

export const getVisibleComplexityFunctions = (
  functions: ReadonlyArray<ComplexityFunctionEntry>,
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
