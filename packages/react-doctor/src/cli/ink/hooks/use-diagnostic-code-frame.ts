import { useMemo } from "react";
import { buildCodeFrame } from "../../utils/build-code-frame.js";
import type { DiagnosticRow } from "../lib/diagnostic-rows.js";

export interface UseDiagnosticCodeFrameInput {
  readonly rootDirectory: string;
  readonly row: DiagnosticRow | null;
}

export const useDiagnosticCodeFrame = ({
  rootDirectory,
  row,
}: UseDiagnosticCodeFrameInput): string | null =>
  useMemo(() => {
    if (!row) return null;
    return buildCodeFrame({
      filePath: row.representative.filePath,
      line: row.representative.line,
      column: row.representative.column,
      rootDirectory,
    });
  }, [rootDirectory, row]);
