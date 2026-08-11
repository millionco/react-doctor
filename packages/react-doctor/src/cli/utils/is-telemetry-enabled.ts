import { isEnvFlagEnabled } from "./is-env-flag-enabled.js";

/**
 * Whether this process may emit telemetry of any kind — Sentry crash reports and
 * Axiom traces/metrics alike.
 *
 * Reads raw `process.argv` rather than parsed Commander options because the
 * decision is needed before the CLI parses its arguments (Sentry initializes as
 * the first statement of `cli/index.ts`).
 *
 * `REACT_DOCTOR_NO_TELEMETRY` was previously honored only by the language
 * server. It applies to the CLI too, which is what lets this repo's own tooling
 * — the benchmark harness and the delta-audit runner — keep their scans out of
 * production telemetry now that disabling Sentry alone no longer silences
 * everything.
 */
export const isTelemetryEnabled = (): boolean => {
  if (process.argv.includes("--no-score") || process.argv.includes("--no-telemetry")) return false;
  if (isEnvFlagEnabled(process.env.REACT_DOCTOR_NO_TELEMETRY)) return false;
  // Never phone home from this repo's own test runs (the e2e suite spawns the
  // built CLI as a subprocess, which inherits VITEST).
  if (process.env.VITEST || process.env.NODE_ENV === "test") return false;
  return true;
};
