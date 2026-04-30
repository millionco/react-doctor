import type { JsonReport, JsonReportMode } from "../types.js";
import { getErrorChainMessages } from "./format-error-chain.js";

interface BuildJsonReportErrorInput {
  version: string;
  directory: string;
  error: unknown;
  elapsedMilliseconds: number;
  mode?: JsonReportMode;
}

const safeStringify = (value: unknown): string => {
  try {
    return String(value);
  } catch {
    return "Unrepresentable error";
  }
};

const safeGetErrorChain = (error: unknown): string[] => {
  try {
    return getErrorChainMessages(error);
  } catch {
    return [safeStringify(error)];
  }
};

export const buildJsonReportError = (input: BuildJsonReportErrorInput): JsonReport => {
  const chain = safeGetErrorChain(input.error);
  const errorPayload =
    input.error instanceof Error
      ? {
          message: input.error.message || input.error.name || "Error",
          name: input.error.name || "Error",
          chain,
        }
      : { message: safeStringify(input.error), name: "Error", chain };

  return {
    schemaVersion: 1,
    version: input.version,
    ok: false,
    directory: input.directory,
    mode: input.mode ?? "full",
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
    error: errorPayload,
  };
};
