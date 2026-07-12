import type { Diagnostic } from "@react-doctor/core";

export const diagnosticIntersectsLineRanges = (
  diagnostic: Diagnostic,
  lineRanges: ReadonlyArray<readonly [number, number]>,
): boolean => {
  const diagnosticEndLine = Math.max(diagnostic.line, diagnostic.endLine ?? diagnostic.line);
  return lineRanges.some(
    ([rangeStartLine, rangeEndLine]) =>
      diagnostic.line <= rangeEndLine && diagnosticEndLine >= rangeStartLine,
  );
};
