import { OUTPUT_MEASURE_WIDTH_CHARS } from "@react-doctor/core";
import { clampNumber } from "./clamp-number.js";
import { MIN_MEASURE_WIDTH_CHARS } from "./constants.js";

// The typographic measure clamped to the live terminal width. Prose and boxes
// wrap to `OUTPUT_MEASURE_WIDTH_CHARS` for comfortable reading, but a narrower
// terminal wins so nothing bleeds past the right edge. `reservedColumns` is the
// leading indent (plus any box chrome) that sits left of the wrapped content.
export const resolveMeasureWidth = (reservedColumns = 0): number => {
  const terminalColumns = process.stdout.columns;
  if (!terminalColumns || terminalColumns <= 0) return OUTPUT_MEASURE_WIDTH_CHARS;
  return clampNumber(
    terminalColumns - reservedColumns,
    MIN_MEASURE_WIDTH_CHARS,
    OUTPUT_MEASURE_WIDTH_CHARS,
  );
};
