import { OUTPUT_MEASURE_WIDTH_CHARS } from "@react-doctor/core";
import { MIN_MEASURE_WIDTH_CHARS } from "./constants.js";

interface ResolveClampedWidthInput {
  // Columns left of the clamped content (leading indent + any box chrome).
  readonly reservedColumns: number;
  // Width used when the terminal column count is unknown (piped / non-TTY).
  readonly fullWidth: number;
  // Lower bound so a pathologically narrow terminal can't collapse content.
  readonly minWidth: number;
}

// Clamps a target width to the live terminal: the terminal width minus
// `reservedColumns`, capped at `fullWidth` and floored at `minWidth`. Returns
// `fullWidth` untouched when the column count is unknown. The single source for
// every terminal-aware width in the CLI renderers.
export const resolveClampedWidth = (input: ResolveClampedWidthInput): number => {
  const terminalColumns = process.stdout.columns;
  if (!terminalColumns || terminalColumns <= 0) return input.fullWidth;
  const availableColumns = terminalColumns - input.reservedColumns;
  return Math.max(input.minWidth, Math.min(input.fullWidth, availableColumns));
};

// The typographic measure clamped to the live terminal width. Prose and boxes
// wrap to `OUTPUT_MEASURE_WIDTH_CHARS` for comfortable reading, but a narrower
// terminal wins so nothing bleeds past the right edge. `reservedColumns` is the
// leading indent (plus any box chrome) that sits left of the wrapped content.
export const resolveMeasureWidth = (reservedColumns = 0): number =>
  resolveClampedWidth({
    reservedColumns,
    fullWidth: OUTPUT_MEASURE_WIDTH_CHARS,
    minWidth: MIN_MEASURE_WIDTH_CHARS,
  });
