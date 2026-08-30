import { loadNativeOxlintBinding } from "../runners/oxlint/load-native-oxlint-binding.js";
import { isRecord } from "../utils/is-record.js";
import { collectStalePackageAnalysisInput } from "./report/packages.js";
import type {
  CircularDependency,
  DependencyGraph,
  ProjectAnalysisConfig,
  SkippedDependency,
  SkippedDependencyReason,
  UnusedDependency,
  UnusedExport,
  UnusedFile,
} from "./types.js";
import { buildExportKey } from "./utils/build-export-key.js";
import { collectConventionConsumedExportKeys } from "./utils/collect-convention-consumed-export-keys.js";

export interface RunNativeProjectAnalysisInput {
  readonly graph: DependencyGraph;
  readonly config: ProjectAnalysisConfig;
  readonly platformSiblingIndex: ReadonlyMap<number, ReadonlyArray<number>>;
}

export interface NativeProjectAnalysisResult {
  readonly unusedFiles?: ReadonlyArray<UnusedFile>;
  readonly verifiedUnusedFiles?: ReadonlyArray<UnusedFile>;
  readonly unusedExports?: ReadonlyArray<UnusedExport>;
  readonly unusedDependencies?: ReadonlyArray<UnusedDependency>;
  readonly skippedDependencies?: ReadonlyArray<SkippedDependency>;
  readonly circularDependencies?: ReadonlyArray<CircularDependency>;
}

const isSkippedDependencyReason = (value: unknown): value is SkippedDependencyReason =>
  value === "allowlisted-name" ||
  value === "ambiguous-binary" ||
  value === "provides-binary" ||
  value === "incomplete-peer-metadata";

const parseUnusedFiles = (value: unknown): UnusedFile[] | null => {
  if (!Array.isArray(value)) return null;
  const unusedFiles: UnusedFile[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      return null;
    }
    unusedFiles.push({ path: entry.path });
  }
  return unusedFiles;
};

const parseUnusedExports = (value: unknown): UnusedExport[] | null => {
  if (!Array.isArray(value)) return null;
  const unusedExports: UnusedExport[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.line !== "number" ||
      typeof entry.column !== "number" ||
      typeof entry.isTypeOnly !== "boolean"
    ) {
      return null;
    }
    unusedExports.push({
      path: entry.path,
      name: entry.name,
      line: entry.line,
      column: entry.column,
      isTypeOnly: entry.isTypeOnly,
    });
  }
  return unusedExports;
};

const parseUnusedDependencies = (value: unknown): UnusedDependency[] | null => {
  if (!Array.isArray(value)) return null;
  const unusedDependencies: UnusedDependency[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      typeof entry.isDevDependency !== "boolean" ||
      typeof entry.reason !== "string"
    ) {
      return null;
    }
    unusedDependencies.push({
      name: entry.name,
      isDevDependency: entry.isDevDependency,
      reason: entry.reason,
    });
  }
  return unusedDependencies;
};

const parseSkippedDependencies = (value: unknown): SkippedDependency[] | null => {
  if (!Array.isArray(value)) return null;
  const skippedDependencies: SkippedDependency[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      typeof entry.isDevDependency !== "boolean" ||
      !Array.isArray(entry.reasons) ||
      !entry.reasons.every(isSkippedDependencyReason)
    ) {
      return null;
    }
    skippedDependencies.push({
      name: entry.name,
      isDevDependency: entry.isDevDependency,
      reasons: entry.reasons,
    });
  }
  return skippedDependencies;
};

const parseCircularDependencies = (value: unknown): CircularDependency[] | null => {
  if (!Array.isArray(value)) return null;
  const circularDependencies: CircularDependency[] = [];
  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !Array.isArray(entry.files) ||
      entry.files.length < 2 ||
      !entry.files.every((filePath) => typeof filePath === "string")
    ) {
      return null;
    }
    circularDependencies.push({ files: entry.files });
  }
  circularDependencies.sort((left, right) => {
    const lengthDifference = left.files.length - right.files.length;
    if (lengthDifference !== 0) return lengthDifference;
    return left.files[0].localeCompare(right.files[0]);
  });
  return circularDependencies;
};

export const runNativeProjectAnalysis = (
  input: RunNativeProjectAnalysisInput,
): NativeProjectAnalysisResult | null => {
  const { graph, config, platformSiblingIndex } = input;
  const binding = loadNativeOxlintBinding();
  if (
    binding === null ||
    typeof binding.reactDoctorNativeProjectRuleIds !== "function" ||
    typeof binding.analyzeReactDoctorProjectGraph !== "function"
  ) {
    return null;
  }
  const nativeRuleIds = binding.reactDoctorNativeProjectRuleIds();
  if (
    !Array.isArray(nativeRuleIds) ||
    !nativeRuleIds.every((ruleId) => typeof ruleId === "string")
  ) {
    throw new Error("Native project analysis returned invalid rule ids.");
  }
  const hasNativeUnusedFile = nativeRuleIds.includes("unused-file");
  const hasNativeUnusedExports =
    nativeRuleIds.includes("unused-export") && nativeRuleIds.includes("unused-type");
  const hasNativeUnusedDependencyAnalysis =
    nativeRuleIds.includes("unused-dependency") && nativeRuleIds.includes("unused-dev-dependency");
  const hasNativeCircularDependency = nativeRuleIds.includes("circular-dependency");
  if (
    !hasNativeUnusedFile &&
    !hasNativeUnusedExports &&
    !hasNativeUnusedDependencyAnalysis &&
    !hasNativeCircularDependency
  ) {
    return null;
  }
  const conventionConsumedExportKeys = hasNativeUnusedExports
    ? collectConventionConsumedExportKeys(graph)
    : new Set<string>();
  const stalePackageAnalysis = hasNativeUnusedDependencyAnalysis
    ? collectStalePackageAnalysisInput(graph, config)
    : null;
  const outputJson = binding.analyzeReactDoctorProjectGraph(
    JSON.stringify({
      modules: graph.modules.map((module) => ({
        index: module.fileId.index,
        path: module.fileId.path,
        exports: module.exports.map((exportInfo) => ({
          name: exportInfo.name,
          isDefault: exportInfo.isDefault,
          isTypeOnly: exportInfo.isTypeOnly,
          isReExport: exportInfo.isReExport,
          isNamespaceReExport: exportInfo.isNamespaceReExport,
          isSynthetic: exportInfo.isSynthetic,
          hasReExportSource: Boolean(exportInfo.reExportSource),
          reExportOriginalName: exportInfo.reExportOriginalName,
          defaultExportLocalName: exportInfo.defaultExportLocalName,
          line: exportInfo.line,
          column: exportInfo.column,
        })),
        memberAccesses: module.memberAccesses,
        wholeObjectUses: module.wholeObjectUses,
        localIdentifierReferences: module.localIdentifierReferences,
        topLevelImportReferences: module.topLevelImportReferences,
        parseErrorCodes: module.parseErrors.flatMap((parseError) =>
          typeof parseError.code === "string" ? [parseError.code] : [],
        ),
        isReachable: module.isReachable,
        isEntryPoint: module.isEntryPoint,
        isExternallyConsumed: module.isExternallyConsumed,
        isDeclarationFile: module.isDeclarationFile,
        isConfigFile: module.isConfigFile,
        isGitIgnored: module.isGitIgnored,
        isAnalysisExcluded: module.isAnalysisExcluded,
        isPackageGraphComplete: module.isPackageGraphComplete,
        hasPackageDynamicLoaderUncertainty: module.hasPackageDynamicLoaderUncertainty,
      })),
      edges: graph.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        importedSymbols: edge.importedSymbols.map((symbol) => ({
          importedName: symbol.importedName,
          localName: symbol.localName,
          isTypeOnly: symbol.isTypeOnly,
          isNamespace: symbol.isNamespace,
          isDefault: symbol.isDefault,
        })),
        isReExportEdge: edge.isReExportEdge,
        isDynamic: edge.isDynamic,
        isSideEffect: edge.isSideEffect,
        isTypeOnly: edge.isTypeOnly,
        reExportedNames: edge.reExportedNames,
        reExportMappings: edge.reExportMappings,
      })),
      platformSiblingIndices: graph.modules.map((_, moduleIndex) =>
        platformSiblingIndex.has(moduleIndex) ? platformSiblingIndex.get(moduleIndex) : null,
      ),
      conventionConsumedExports: graph.modules.flatMap((module) =>
        module.exports.flatMap((exportInfo) =>
          conventionConsumedExportKeys.has(buildExportKey(module.fileId.path, exportInfo.name))
            ? [{ path: module.fileId.path, name: exportInfo.name }]
            : [],
        ),
      ),
      reportTypes: config.reportTypes,
      includeEntryExports: config.includeEntryExports,
      ...(stalePackageAnalysis === null ? {} : { stalePackageAnalysis }),
    }),
  );
  if (typeof outputJson !== "string") {
    throw new Error("Native project analysis returned a non-string result.");
  }
  let output: unknown;
  try {
    output = JSON.parse(outputJson);
  } catch {
    throw new Error("Native project analysis returned invalid JSON.");
  }
  if (!isRecord(output)) throw new Error("Native project analysis returned an invalid result.");
  const unusedFiles = hasNativeUnusedFile ? parseUnusedFiles(output.unusedFiles) : null;
  const verifiedUnusedFiles = hasNativeUnusedFile
    ? parseUnusedFiles(output.verifiedUnusedFiles)
    : null;
  const unusedExports = hasNativeUnusedExports ? parseUnusedExports(output.unusedExports) : null;
  const unusedDependencies = hasNativeUnusedDependencyAnalysis
    ? parseUnusedDependencies(output.unusedDependencies)
    : null;
  const skippedDependencies = hasNativeUnusedDependencyAnalysis
    ? parseSkippedDependencies(output.skippedDependencies)
    : null;
  const circularDependencies = hasNativeCircularDependency
    ? parseCircularDependencies(output.circularDependencies)
    : null;
  return {
    ...(unusedFiles !== null && verifiedUnusedFiles !== null
      ? { unusedFiles, verifiedUnusedFiles }
      : {}),
    ...(unusedExports === null ? {} : { unusedExports }),
    ...(unusedDependencies !== null && skippedDependencies !== null
      ? { unusedDependencies, skippedDependencies }
      : {}),
    ...(circularDependencies === null ? {} : { circularDependencies }),
  };
};
