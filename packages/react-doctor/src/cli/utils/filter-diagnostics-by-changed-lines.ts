import path from "node:path";
import type { ChangedFileLineRanges, Diagnostic } from "@react-doctor/core";
import { diagnosticIntersectsLineRanges } from "./diagnostic-intersects-line-ranges.js";
import { toForwardSlashes } from "./path-format.js";

interface FilterDiagnosticsByChangedLinesInput {
  readonly directory: string;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly changedLineRanges: ReadonlyArray<ChangedFileLineRanges>;
}

export const filterDiagnosticsByChangedLines = (
  input: FilterDiagnosticsByChangedLinesInput,
): ReadonlyArray<Diagnostic> => {
  const rangesByFile = new Map<string, ReadonlyArray<readonly [number, number]>>();
  for (const entry of input.changedLineRanges) {
    rangesByFile.set(toForwardSlashes(entry.file), entry.ranges);
  }

  return input.diagnostics.filter((diagnostic) => {
    const relativePath = toForwardSlashes(
      path.isAbsolute(diagnostic.filePath)
        ? path.relative(input.directory, diagnostic.filePath)
        : diagnostic.filePath,
    );
    const ranges = rangesByFile.get(relativePath);
    return ranges !== undefined && diagnosticIntersectsLineRanges(diagnostic, ranges);
  });
};
