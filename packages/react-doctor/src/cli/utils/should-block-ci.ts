import type { BlockingLevel, Diagnostic } from "@react-doctor/core";

// Whether the scan should block CI (exit non-zero) at the given threshold:
// `none` never blocks, `warning` blocks on any diagnostic, `error` blocks only
// when at least one `"error"`-severity diagnostic is present.
export const shouldBlockCi = (diagnostics: Diagnostic[], blockingLevel: BlockingLevel): boolean => {
  if (blockingLevel === "none") return false;
  if (blockingLevel === "warning") return diagnostics.length > 0;
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
};
