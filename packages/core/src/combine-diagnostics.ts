import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/types";
import { checkReducedMotion } from "./check-reduced-motion.js";
import { createNodeReadFileLinesSync } from "./read-file-lines-node.js";
import { mergeAndFilterDiagnostics } from "./merge-and-filter-diagnostics.js";

interface CombineDiagnosticsInput {
  lintDiagnostics: Diagnostic[];
  directory: string;
  isDiffMode: boolean;
  userConfig: ReactDoctorConfig | null;
  readFileLinesSync?: (filePath: string) => string[] | null;
  includeEnvironmentChecks?: boolean;
  respectInlineDisables?: boolean;
}

export const combineDiagnostics = (input: CombineDiagnosticsInput): Diagnostic[] => {
  const {
    lintDiagnostics,
    directory,
    isDiffMode,
    userConfig,
    readFileLinesSync = createNodeReadFileLinesSync(directory),
    includeEnvironmentChecks = true,
    respectInlineDisables,
  } = input;
  const extraDiagnostics =
    isDiffMode || !includeEnvironmentChecks ? [] : checkReducedMotion(directory);
  const merged = [...lintDiagnostics, ...extraDiagnostics];
  return mergeAndFilterDiagnostics(merged, directory, userConfig, readFileLinesSync, {
    respectInlineDisables,
  });
};
