import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import { highlighter } from "@react-doctor/core";

/**
 * Thin synchronous façade over Effect's `Console` module. Used by
 * the imperative CLI helper files (`select-projects`, `run-explain`,
 * `install-skill`, the legacy paths in `cli/commands/inspect.ts`)
 * that aren't yet Effect-typed. Every call drains into a single
 * `Console.*` Effect via `Effect.runSync`, so the underlying logging
 * pipeline is identical to the canonical `yield* Console.log(...)`
 * call sites in the renderers. Convert callers to `Effect.gen` to
 * drop the bridge.
 */
export const cliLogger = {
  log: (message: string): void => {
    Effect.runSync(Console.log(message));
  },
  warn: (message: string): void => {
    Effect.runSync(Console.warn(message));
  },
  error: (message: string): void => {
    Effect.runSync(Console.error(message));
  },
  info: (message: string): void => {
    Effect.runSync(Console.info(message));
  },
  dim: (message: string): void => {
    Effect.runSync(Console.log(highlighter.gray(message)));
  },
  success: (message: string): void => {
    Effect.runSync(Console.log(highlighter.success(message)));
  },
  break: (): void => {
    Effect.runSync(Console.log(""));
  },
} as const;
