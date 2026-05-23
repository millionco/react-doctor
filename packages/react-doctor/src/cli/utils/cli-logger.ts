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
  // Matches the legacy `consoleLogger`'s color contract:
  //   warn  → yellow (highlighter.warn)
  //   error → red (highlighter.error)
  //   info  → cyan (highlighter.info)
  //   dim   → gray
  //   success → green
  // Bugbot regression #432: without these, warning / error / info
  // messages from `install-skill.ts`, `resolve-diff-mode.ts`, and
  // `resolve-fail-on-level.ts` rendered as plain uncolored text.
  warn: (message: string): void => {
    Effect.runSync(Console.warn(highlighter.warn(message)));
  },
  error: (message: string): void => {
    Effect.runSync(Console.error(highlighter.error(message)));
  },
  info: (message: string): void => {
    Effect.runSync(Console.info(highlighter.info(message)));
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
