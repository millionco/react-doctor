import { performance } from "node:perf_hooks";
import { buildJsonReportError, setLoggerSilent } from "@react-doctor/core";
import type { JsonReport, JsonReportMode } from "@react-doctor/types";
import { INTERNAL_ERROR_JSON_FALLBACK } from "./constants.js";
import { VERSION } from "./version.js";

interface JsonModeContext {
  compact: boolean;
  startTime: number;
  directory: string;
  mode: JsonReportMode;
}

let context: JsonModeContext | null = null;

interface EnableJsonModeInput {
  compact: boolean;
  directory: string;
}

export const enableJsonMode = ({ compact, directory }: EnableJsonModeInput): void => {
  context = { compact, directory, startTime: performance.now(), mode: "full" };
  setLoggerSilent(true);
};

export const isJsonModeActive = (): boolean => context !== null;

export const setJsonReportDirectory = (directory: string): void => {
  if (context) context.directory = directory;
};

export const setJsonReportMode = (mode: JsonReportMode): void => {
  if (context) context.mode = mode;
};

export const writeJsonReport = (report: JsonReport): void => {
  const serialized = context?.compact ? JSON.stringify(report) : JSON.stringify(report, null, 2);
  process.stdout.write(`${serialized}\n`);
};

export const writeJsonErrorReport = (error: unknown): void => {
  if (!context) return;
  try {
    writeJsonReport(
      buildJsonReportError({
        version: VERSION,
        directory: context.directory,
        error,
        elapsedMilliseconds: performance.now() - context.startTime,
        mode: context.mode,
      }),
    );
  } catch {
    process.stdout.write(INTERNAL_ERROR_JSON_FALLBACK);
  }
};
