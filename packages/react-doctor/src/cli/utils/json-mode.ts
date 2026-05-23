import { performance } from "node:perf_hooks";
import { buildJsonReportError } from "@react-doctor/core";
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

/**
 * JSON mode writes the report payload to stdout; any incidental
 * log line printed by an Effect program would corrupt the JSON.
 * Effect's `Console` module resolves to `globalThis.console` by
 * default (see `effect/internal/effect.ts` → `ConsoleRef`), so
 * monkey-patching the global is enough to silence every
 * `yield* Console.log(...)` and `cliLogger.*` call sourced from
 * react-doctor or its services. We snapshot the originals (used
 * by `writeJsonReport` → `process.stdout.write`) and never need
 * to restore — JSON mode is one-shot per CLI invocation.
 */
const installSilentConsole = (): void => {
  const noop = (): void => {};
  const console = globalThis.console as unknown as Record<string, unknown>;
  for (const key of ["log", "error", "warn", "info", "debug", "trace"]) {
    console[key] = noop;
  }
};

export const enableJsonMode = ({ compact, directory }: EnableJsonModeInput): void => {
  context = { compact, directory, startTime: performance.now(), mode: "full" };
  installSilentConsole();
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
