import type { Diagnostic, ReactDoctorConfig } from "../types.js";
import { filterIgnoredDiagnostics, filterInlineSuppressions } from "./filter-diagnostics.js";

interface MergeAndFilterOptions {
  respectInlineDisables?: boolean;
}

export const mergeAndFilterDiagnostics = (
  mergedDiagnostics: Diagnostic[],
  directory: string,
  userConfig: ReactDoctorConfig | null,
  readFileLinesSync: (filePath: string) => string[] | null,
  options: MergeAndFilterOptions = {},
): Diagnostic[] => {
  const filtered = userConfig
    ? filterIgnoredDiagnostics(mergedDiagnostics, userConfig, directory, readFileLinesSync)
    : mergedDiagnostics;
  if (options.respectInlineDisables === false) return filtered;
  return filterInlineSuppressions(filtered, directory, readFileLinesSync);
};
