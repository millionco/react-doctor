import { performance } from "node:perf_hooks";
import { buildJsonReportError } from "@react-doctor/core";
import type { JsonReport, JsonReportMode } from "@react-doctor/core";
import { INTERNAL_ERROR_JSON_FALLBACK } from "./constants.js";
import { makeNoopConsole } from "./noop-console.js";
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
 * JSON mode writes the report payload to stdout; any incidental log
 * line printed by an Effect program would corrupt the JSON. Effect's
 * `Console` module resolves to `globalThis.console` by default (see
 * `effect/internal/effect.ts` → `ConsoleRef`), so copying the methods
 * from `makeNoopConsole()` onto the global is enough to silence every
 * `yield* Console.log(...)` and `cliLogger.*` call sourced from
 * react-doctor or its services.
 *
 * We use the same `makeNoopConsole()` source as the `--silent` path
 * (which provides the Effect Console via
 * `Effect.provideService(Console.Console, makeNoopConsole())`) — one
 * canonical "no-op console" definition shared by the two silent
 * mechanisms. The two routes still differ in how they install the
 * noop: silent mode swaps the Effect Console reference inside the
 * program; JSON mode patches the global because the surrounding CLI
 * command body is still imperative. Both will collapse into the
 * Effect-typed route once the command body finishes its migration.
 *
 * JSON mode is one-shot per CLI invocation, so we never restore.
 */
const installSilentConsole = (): void => {
  const noopConsole = makeNoopConsole();
  const target = globalThis.console as unknown as Record<string, unknown>;
  const source = noopConsole as unknown as Record<string, unknown>;
  for (const key of ["log", "error", "warn", "info", "debug", "trace"]) {
    target[key] = source[key];
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

export const writeJsonErrorReport = (error: unknown, sentryEventId?: string | null): void => {
  if (!context) return;
  try {
    writeJsonReport(
      buildJsonReportError({
        version: VERSION,
        directory: context.directory,
        error,
        elapsedMilliseconds: performance.now() - context.startTime,
        mode: context.mode,
        sentryEventId,
      }),
    );
  } catch {
    process.stdout.write(INTERNAL_ERROR_JSON_FALLBACK);
  }
};
