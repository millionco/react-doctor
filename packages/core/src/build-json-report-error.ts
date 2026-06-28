import type { JsonReport, JsonReportMode } from "./types/index.js";
import { formatReactDoctorError, isReactDoctorError } from "./errors.js";
import { getErrorChainMessages } from "./format-error-chain.js";
import { anonymizeSensitiveText } from "./utils/anonymize-sensitive-text.js";

interface BuildJsonReportErrorInput {
  version: string;
  directory: string;
  error: unknown;
  elapsedMilliseconds: number;
  mode?: JsonReportMode;
  /** Sentry event id for the crash, when the run reported one. */
  sentryEventId?: string | null;
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

const anonymizeMessages = (messages: string[]): string[] => messages.map(anonymizeSensitiveText);

export const buildJsonReportError = (input: BuildJsonReportErrorInput): JsonReport => {
  const chain = anonymizeMessages(safeGetErrorChain(input.error));
  const sentryEventId = input.sentryEventId ?? null;
  const errorPayload = isReactDoctorError(input.error)
    ? {
        message: anonymizeSensitiveText(formatReactDoctorError(input.error)),
        name: `ReactDoctorError(${input.error.reason._tag})`,
        chain,
        sentryEventId,
      }
    : input.error instanceof Error
      ? {
          message: anonymizeSensitiveText(input.error.message || input.error.name || "Error"),
          name: input.error.name || "Error",
          chain,
          sentryEventId,
        }
      : {
          message: anonymizeSensitiveText(safeStringify(input.error)),
          name: "Error",
          chain,
          sentryEventId,
        };

  return {
    schemaVersion: 1,
    version: input.version,
    ok: false,
    directory: anonymizeSensitiveText(input.directory),
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
