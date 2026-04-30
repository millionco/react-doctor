import type { JsonReport } from "../types.js";

interface BuildJsonReportErrorInput {
  version: string;
  directory: string;
  error: unknown;
  elapsedMilliseconds: number;
}

export const buildJsonReportError = (input: BuildJsonReportErrorInput): JsonReport => {
  const error =
    input.error instanceof Error
      ? { message: input.error.message, name: input.error.name }
      : { message: String(input.error), name: "Error" };

  return {
    schemaVersion: 1,
    version: input.version,
    ok: false,
    directory: input.directory,
    mode: "full",
    diff: null,
    projects: [],
    diagnostics: [],
    summary: {
      errorCount: 0,
      warningCount: 0,
      affectedFileCount: 0,
      totalDiagnosticCount: 0,
      score: null,
      scoreLabel: null,
    },
    elapsedMilliseconds: input.elapsedMilliseconds,
    error,
  };
};
