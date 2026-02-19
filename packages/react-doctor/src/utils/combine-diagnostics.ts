import { JSX_FILE_PATTERN } from "../constants.js";
import type { Diagnostic, ReactDoctorConfig } from "../types.js";
import { checkReducedMotion } from "./check-reduced-motion.js";
import { filterIgnoredDiagnostics } from "./filter-diagnostics.js";

export const computeJsxIncludePaths = (includePaths: string[]): string[] | undefined =>
  includePaths.length > 0
    ? includePaths.filter((filePath) => JSX_FILE_PATTERN.test(filePath))
    : undefined;

export const combineDiagnostics = (
  lintDiagnostics: Diagnostic[],
  deadCodeDiagnostics: Diagnostic[],
  directory: string,
  isDiffMode: boolean,
  userConfig: ReactDoctorConfig | null,
): Diagnostic[] => {
  const allDiagnostics = [
    ...lintDiagnostics,
    ...deadCodeDiagnostics,
    ...(isDiffMode ? [] : checkReducedMotion(directory)),
  ];
  return userConfig ? filterIgnoredDiagnostics(allDiagnostics, userConfig) : allDiagnostics;
};
