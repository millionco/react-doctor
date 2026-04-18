import type { Diagnostic, ReactDoctorConfig } from "../types.js";
import { checkReducedMotion } from "./check-reduced-motion.js";
import { createNodeReadFileLinesSync } from "./read-file-lines-node.js";
import { mergeAndFilterDiagnostics } from "./merge-and-filter-diagnostics.js";

export { mergeAndFilterDiagnostics } from "./merge-and-filter-diagnostics.js";
export { computeJsxIncludePaths } from "./jsx-include-paths.js";

export const combineDiagnostics = (
  lintDiagnostics: Diagnostic[],
  deadCodeDiagnostics: Diagnostic[],
  directory: string,
  isDiffMode: boolean,
  userConfig: ReactDoctorConfig | null,
  readFileLinesSync: (filePath: string) => string[] | null = createNodeReadFileLinesSync(directory),
  includeEnvironmentChecks = true,
): Diagnostic[] => {
  const extraDiagnostics =
    isDiffMode || !includeEnvironmentChecks ? [] : checkReducedMotion(directory);
  const merged = [...lintDiagnostics, ...deadCodeDiagnostics, ...extraDiagnostics];
  return mergeAndFilterDiagnostics(merged, directory, userConfig, readFileLinesSync);
};
