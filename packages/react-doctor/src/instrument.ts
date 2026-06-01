import * as Sentry from "@sentry/node";
import { SENTRY_DSN } from "./cli/utils/constants.js";
import { VERSION } from "./cli/utils/version.js";

let isInitialized = false;

const shouldEnableSentry = (): boolean => {
  // `--no-score` (and its `--no-telemetry` alias) opts out of crash
  // reporting. Read from raw argv because Sentry initializes before
  // Commander parses.
  if (process.argv.includes("--no-score") || process.argv.includes("--no-telemetry")) return false;
  // Never phone home from this repo's own test runs (the e2e suite
  // spawns the built CLI as a subprocess, which inherits VITEST).
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false;
  return true;
};

/**
 * Initializes the Sentry Node SDK for CLI crash reporting. Invoked as
 * the first statement of the CLI entry (`cli/index.ts`) so the SDK's
 * global `uncaughtException` / `unhandledRejection` handlers are armed
 * before any command runs.
 *
 * Exported as a function rather than a bare side-effecting import
 * because the package declares `"sideEffects": false`, which lets the
 * bundler tree-shake side-effect-only modules. An explicit call keeps
 * the initialization in the published `dist/cli.js`.
 *
 * Scoped to the CLI application only — the programmatic
 * `@react-doctor/api` library never initializes Sentry, so importing
 * `diagnose()` into a consumer app can't hijack their telemetry.
 */
export const initializeSentry = (): void => {
  if (isInitialized || !shouldEnableSentry()) return;
  isInitialized = true;
  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: true,
    release: VERSION,
  });
};
