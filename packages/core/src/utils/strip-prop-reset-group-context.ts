import type { Diagnostic } from "../types/index.js";

export const stripPropResetGroupContext = (diagnostic: Diagnostic): Diagnostic => {
  if (
    diagnostic.plugin !== "react-doctor" ||
    diagnostic.rule !== "no-reset-all-state-on-prop-change" ||
    diagnostic.contextRanges === undefined
  ) {
    return diagnostic;
  }
  const { contextRanges: _contextRanges, ...publicDiagnostic } = diagnostic;
  return publicDiagnostic;
};
