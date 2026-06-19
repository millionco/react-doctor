/**
 * Whether the user passed `--debug` (surface the run's Sentry trace id, and
 * force performance tracing on so there's a trace to surface). Read straight
 * from argv rather than Commander's parsed flags because `initializeSentry()`
 * runs before Commander parses — the same reason `shouldEnableSentry()` reads
 * `--no-score` from argv. Sharing this one reader keeps the init-time sampling
 * override and the end-of-run print in agreement.
 */
export const isDebugFlagEnabled = (argv: ReadonlyArray<string> = process.argv): boolean =>
  argv.includes("--debug");
