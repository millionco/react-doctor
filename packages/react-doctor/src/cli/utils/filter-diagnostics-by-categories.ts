import type { Diagnostic } from "@react-doctor/core";

export const filterDiagnosticsByCategories = (
  diagnostics: ReadonlyArray<Diagnostic>,
  categories: ReadonlySet<string>,
): Diagnostic[] =>
  categories.size === 0
    ? [...diagnostics]
    : diagnostics.filter((diagnostic) => categories.has(diagnostic.category));
