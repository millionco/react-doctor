import type { Diagnostic, ReactDoctorConfig } from "./types/index.js";
import { buildDiagnosticPipeline } from "./build-diagnostic-pipeline.js";

interface MergeAndFilterOptions {
  respectInlineDisables?: boolean;
}

export const clearAutoSuppressionCaches = (): void => {
  return undefined;
};

export const mergeAndFilterDiagnostics = (
  mergedDiagnostics: Diagnostic[],
  directory: string,
  userConfig: ReactDoctorConfig | null,
  readFileLinesSync: (filePath: string) => string[] | null,
  options: MergeAndFilterOptions = {},
): Diagnostic[] => {
  const pipeline = buildDiagnosticPipeline({
    rootDirectory: directory,
    userConfig,
    readFileLinesSync,
    respectInlineDisables: options.respectInlineDisables !== false,
  });
  return mergedDiagnostics.flatMap((diagnostic) => {
    const filtered = pipeline.apply(diagnostic);
    return filtered === null ? [] : [filtered];
  });
};
