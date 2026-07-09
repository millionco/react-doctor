import type { Diagnostic } from "@react-doctor/core";

export const filterDiagnosticsByTags = (
  diagnostics: ReadonlyArray<Diagnostic>,
  excludeTags: ReadonlySet<string>,
  includeTags: ReadonlySet<string>,
): Diagnostic[] => {
  if (excludeTags.size === 0 && includeTags.size === 0) return [...diagnostics];

  return diagnostics.filter((diagnostic) => {
    const diagnosticTags = diagnostic.tags ?? [];

    if (includeTags.size > 0) {
      return diagnosticTags.some((tag) => includeTags.has(tag));
    }

    if (excludeTags.size > 0) {
      return !diagnosticTags.some((tag) => excludeTags.has(tag));
    }

    return true;
  });
};
