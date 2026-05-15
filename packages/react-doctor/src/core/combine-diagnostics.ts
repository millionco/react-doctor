import type { ReactDoctorConfig } from "../types/config.js";
import type { Diagnostic } from "../types/diagnostic.js";
import { checkReducedMotion } from "./check-reduced-motion.js";
import { createNodeReadFileLinesSync } from "./read-file-lines-node.js";
import { mergeAndFilterDiagnostics } from "./merge-and-filter-diagnostics.js";

interface CombineDiagnosticsInput {
  lintDiagnostics: Diagnostic[];
  deadCodeDiagnostics: Diagnostic[];
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
    deadCodeDiagnostics,
    directory,
    isDiffMode,
    userConfig,
    readFileLinesSync = createNodeReadFileLinesSync(directory),
    includeEnvironmentChecks = true,
    respectInlineDisables,
  } = input;
  const extraDiagnostics =
    isDiffMode || !includeEnvironmentChecks ? [] : checkReducedMotion(directory);
  const merged = [...lintDiagnostics, ...deadCodeDiagnostics, ...extraDiagnostics];
  return mergeAndFilterDiagnostics(merged, directory, userConfig, readFileLinesSync, {
    respectInlineDisables,
  });
};
