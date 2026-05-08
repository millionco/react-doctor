import { JSX_OPENER_SCAN_MAX_LINES } from "../constants.js";
import { findJsxOpenerSpan } from "./find-jsx-opener-span.js";

export const findEnclosingMultilineJsxOpenerStart = (
  lines: string[],
  diagnosticLineIndex: number,
): number | null => {
  for (
    let candidateIndex = diagnosticLineIndex - 1;
    candidateIndex >= 0 && diagnosticLineIndex - candidateIndex <= JSX_OPENER_SCAN_MAX_LINES;
    candidateIndex--
  ) {
    const openerCloseIndex = findJsxOpenerSpan(lines, candidateIndex);
    if (openerCloseIndex !== null && openerCloseIndex >= diagnosticLineIndex) {
      return candidateIndex;
    }
  }
  return null;
};
