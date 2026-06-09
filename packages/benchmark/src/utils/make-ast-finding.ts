import type { ParsedSourceFile, ScanFinding, ScannerName, SlopDimension } from "../types/index.js";
import { offsetToLine } from "./offset-to-line.js";

export interface MakeAstFindingInput {
  file: ParsedSourceFile;
  scanner: ScannerName;
  dimension: SlopDimension;
  ruleId: string;
  severity: "error" | "warning";
  // Byte offset of the offending node (oxc `node.start`); converted to a line.
  offset: number;
  message: string;
}

// Build a `ScanFinding` from an AST node offset, resolving the 1-based line
// from the file's source text. Keeps the individual checks free of
// line-bookkeeping boilerplate.
export const makeAstFinding = (input: MakeAstFindingInput): ScanFinding => ({
  scanner: input.scanner,
  dimension: input.dimension,
  ruleId: input.ruleId,
  severity: input.severity,
  filePath: input.file.filePath,
  line: offsetToLine(input.file.sourceText, input.offset),
  message: input.message,
});
