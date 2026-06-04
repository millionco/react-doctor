import * as Sentry from "@sentry/node";
import { buildSentryScope } from "./cli/utils/build-sentry-scope.js";
import {
  SENTRY_DEFAULT_TRACES_SAMPLE_RATE,
  SENTRY_DSN,
  SENTRY_FLUSH_TIMEOUT_MS,
  SENTRY_RELEASE_PREFIX,
} from "./cli/utils/constants.js";
import { scrubSentryEvent } from "./cli/utils/scrub-sentry-event.js";
import { scrubSentryMetric } from "./cli/utils/scrub-sentry-metric.js";
import { VERSION } from "./cli/utils/version.js";

let isInitialized = false;
// Cached at init so `isSentryTracingEnabled()` (read on hot paths in
// inspect.ts) doesn't re-parse the environment on every call and always
// agrees with the rate handed to `Sentry.init`.
let resolvedTracesSampleRate = 0;

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

const isEnvFlagEnabled = (value: string | undefined): boolean =>
  value === "1" || value?.toLowerCase() === "true";

/**
 * A version is a "dev" build when it's the unbuilt placeholder (`0.0.0`) or
 * carries a prerelease suffix (e.g. the `-dev.<sha>` snapshots published from
 * CI). Everything else is a real, tagged release.
 */
const isDevVersion = (version: string): boolean => version === "0.0.0" || version.includes("-");

/**
 * Sentry release identifier. `react-doctor@<version>` keeps it unique within
 * the org and — crucially — matches the value `scripts/sentry-sourcemaps.mjs`
 * uploads source-map artifacts under, so stack frames symbolicate. Honors the
 * standard `SENTRY_RELEASE` override.
 */
export const resolveSentryRelease = (): string =>
  process.env.SENTRY_RELEASE || `${SENTRY_RELEASE_PREFIX}@${VERSION}`;

/**
 * Deployment environment shown in Sentry's environment filter. Defaults to
 * `production` for tagged releases and `development` for dev/unbuilt versions,
 * overridable via the standard `SENTRY_ENVIRONMENT` env var.
 */
export const resolveSentryEnvironment = (): string =>
  process.env.SENTRY_ENVIRONMENT || (isDevVersion(VERSION) ? "development" : "production");

/**
 * Performance-tracing sample rate in `[0, 1]`. Reads `SENTRY_TRACES_SAMPLE_RATE`
 * (set to `0` to disable tracing) and falls back to
 * {@link SENTRY_DEFAULT_TRACES_SAMPLE_RATE}. Invalid / out-of-range values fall
 * back to the default rather than silently disabling tracing.
 */
export const resolveTracesSampleRate = (): number => {
  const raw = process.env.SENTRY_TRACES_SAMPLE_RATE;
  if (raw === undefined || raw.trim() === "") return SENTRY_DEFAULT_TRACES_SAMPLE_RATE;
  const parsed = Number(raw);
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) return SENTRY_DEFAULT_TRACES_SAMPLE_RATE;
  return parsed;
};

/**
 * Whether performance traces will actually be recorded — Sentry is live and the
 * resolved sample rate is above zero. Used to gate the per-run root span and
 * the Effect→Sentry tracer bridge so they're true no-ops when tracing is off.
 */
export const isSentryTracingEnabled = (): boolean =>
  Sentry.isInitialized() && resolvedTracesSampleRate > 0;

/**
 * Flushes queued Sentry events (errors + transactions) before the CLI exits, so
 * the success-path transaction is delivered. A no-op when Sentry was never
 * initialized, and it swallows transport failures so telemetry can never mask
 * the user's result.
 */
export const flushSentry = async (): Promise<void> => {
  if (!Sentry.isInitialized()) return;
  try {
    await Sentry.flush(SENTRY_FLUSH_TIMEOUT_MS);
  } catch {}
};

/**
 * Initializes the Sentry Node SDK for CLI crash reporting and performance
 * tracing. Invoked as the first statement of the CLI entry (`cli/index.ts`) so
 * the SDK's global `uncaughtException` / `unhandledRejection` handlers and OTel
 * auto-instrumentation are armed before any command runs.
 *
 * Exported as a function rather than a bare side-effecting import because the
 * package declares `"sideEffects": false`, which lets the bundler tree-shake
 * side-effect-only modules. An explicit call keeps the initialization in the
 * published `dist/cli.js`.
 *
 * Scoped to the CLI application only — the programmatic `@react-doctor/api`
 * library never initializes Sentry, so importing `diagnose()` into a consumer
 * app can't hijack their telemetry.
 *
 * Configuration is environment-overridable for self-hosting and tuning:
 * `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`,
 * `SENTRY_TRACES_SAMPLE_RATE` (`0` disables tracing), and `SENTRY_DEBUG`.
 */
export const initializeSentry = (): void => {
  if (isInitialized || !shouldEnableSentry()) return;
  isInitialized = true;
  resolvedTracesSampleRate = resolveTracesSampleRate();
  const { tags, contexts } = buildSentryScope();
  Sentry.init({
    dsn: process.env.SENTRY_DSN || SENTRY_DSN,
    release: resolveSentryRelease(),
    environment: resolveSentryEnvironment(),
    // Anonymized telemetry: never attach the user's IP address.
    sendDefaultPii: false,
    tracesSampleRate: resolvedTracesSampleRate,
    debug: isEnvFlagEnabled(process.env.SENTRY_DEBUG),
    // Seed the scope so the run snapshot rides along with *every* event,
    // including performance transactions — not just captured exceptions.
    // (Only `run` exists at init; the scanned `project` context is added later
    // once a scan discovers it.)
    initialScope: { tags, contexts },
    // Anonymize every outgoing event/transaction: strip hostname/IP/device
    // identity, drop captured local variables, and scrub home-directory paths
    // and known secrets from all remaining strings. Returns `null` to drop the
    // event if scrubbing fails, so un-anonymized data is never sent.
    beforeSend: (event) => scrubSentryEvent(event),
    beforeSendTransaction: (event) => scrubSentryEvent(event),
    // Same anonymization contract for Application Metrics (counters/distributions):
    // drop the `server.address` hostname attribute and scrub paths/secrets from
    // attribute values, dropping the metric on failure. Metrics are enabled by
    // default and flow independently of `tracesSampleRate`. The run + project
    // snapshot is merged onto each metric at emit time (see `record-metric.ts`),
    // mirroring how `buildSentryScope` rebuilds event tags, so metrics track
    // runtime state instead of a stale init-time snapshot.
    beforeSendMetric: (metric) => scrubSentryMetric(metric),
  });
};
