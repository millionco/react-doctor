import type { DiagnosticSurface } from "@react-doctor/core";

export interface BuildEmptyReportMessageInput {
  readonly categoryFilters: Iterable<string>;
  readonly demotedDiagnosticCount: number;
  readonly outputSurface: DiagnosticSurface;
}

export const buildEmptyReportMessage = (input: BuildEmptyReportMessageInput): string => {
  const categoryFilters = [...input.categoryFilters];
  if (categoryFilters.length > 0) {
    return `No issues found in category ${categoryFilters.join(", ")}!`;
  }
  if (input.demotedDiagnosticCount > 0) {
    return `No issues found! (${input.demotedDiagnosticCount} demoted from the ${input.outputSurface} surface — see config.surfaces.)`;
  }
  return "No issues found!";
};
