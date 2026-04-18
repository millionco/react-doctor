import type { Diagnostic, ReactDoctorConfig } from "../types.js";
import { filterIgnoredDiagnostics, filterInlineSuppressions } from "./filter-diagnostics.js";

export const mergeAndFilterDiagnostics = (
  mergedDiagnostics: Diagnostic[],
  directory: string,
  userConfig: ReactDoctorConfig | null,
  readFileLinesSync: (filePath: string) => string[] | null,
): Diagnostic[] => {
  const filtered = userConfig
    ? filterIgnoredDiagnostics(mergedDiagnostics, userConfig, directory, readFileLinesSync)
    : mergedDiagnostics;
  return filterInlineSuppressions(filtered, directory, readFileLinesSync);
};
