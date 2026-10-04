import type { Diagnostic } from "@react-doctor/core";

export const collectAffectedFiles = (diagnostics: ReadonlyArray<Diagnostic>): Set<string> =>
  new Set(diagnostics.map((diagnostic) => diagnostic.filePath));
