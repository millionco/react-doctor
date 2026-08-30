import { loadNativeOxlintBinding } from "../runners/oxlint/load-native-oxlint-binding.js";
import { isRecord } from "../utils/is-record.js";
import type { DependencyGraph, UnusedFile } from "./types.js";

export interface NativeProjectAnalysisResult {
  readonly unusedFiles: ReadonlyArray<UnusedFile>;
  readonly verifiedUnusedFiles: ReadonlyArray<UnusedFile>;
}

const parseUnusedFiles = (value: unknown, label: string): UnusedFile[] => {
  if (!Array.isArray(value)) throw new Error(`Native project analysis returned invalid ${label}.`);
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.path !== "string") {
      throw new Error(`Native project analysis returned invalid ${label}[${index}].`);
    }
    return { path: entry.path };
  });
};

export const runNativeProjectAnalysis = (
  graph: DependencyGraph,
): NativeProjectAnalysisResult | null => {
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
  if (!nativeRuleIds.includes("unused-file")) return null;
  const outputJson = binding.analyzeReactDoctorProjectGraph(
    JSON.stringify({
      modules: graph.modules.map((module) => ({
        path: module.fileId.path,
        exports: module.exports.map((exportInfo) => ({
          isNamespaceReExport: exportInfo.isNamespaceReExport,
          isSynthetic: exportInfo.isSynthetic,
        })),
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
      })),
      edges: graph.edges.map((edge) => ({
        source: edge.source,
        target: edge.target,
        isReExportEdge: edge.isReExportEdge,
      })),
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
  return {
    unusedFiles: parseUnusedFiles(output.unusedFiles, "unusedFiles"),
    verifiedUnusedFiles: parseUnusedFiles(output.verifiedUnusedFiles, "verifiedUnusedFiles"),
  };
};
