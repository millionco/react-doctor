import type { Diagnostic, ReactDoctorConfig } from "./types/index.js";
import { buildDiagnosticPipeline } from "./build-diagnostic-pipeline.js";
import { DEFAULT_SHOW_WARNINGS } from "./constants.js";

interface MergeAndFilterOptions {
  respectInlineDisables?: boolean;
  /** See `ReactDoctorConfig.warnings`. Falls back to `userConfig.warnings ?? true`. */
  warnings?: boolean;
}

/**
 * Back-compat alias: the streaming pipeline holds its caches in
 * per-pipeline closures that are garbage-collected when the pipeline
 * goes out of scope, so there is nothing to clear at module scope. The
 * public CLI's `clearCaches()` still calls this for symmetry with the
 * other `clear*` helpers.
 */
export const clearAutoSuppressionCaches = (): void => {};

/**
 * Array-shaped wrapper over `buildDiagnosticPipeline` for legacy
 * callers and tests. Production code uses the streaming pipeline
 * inside `runInspect`; this thin shim runs the same per-element
 * closure over an in-memory diagnostic array.
 */
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
    respectInlineDisables: options.respectInlineDisables ?? true,
    showWarnings: options.warnings ?? userConfig?.warnings ?? DEFAULT_SHOW_WARNINGS,
  });
  const result: Diagnostic[] = [];
  for (const diagnostic of mergedDiagnostics) {
    const filtered = pipeline.apply(diagnostic);
    if (filtered !== null) result.push(filtered);
  }
  return result;
};
