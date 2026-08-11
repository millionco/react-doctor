import * as Sentry from "@sentry/node";
import { buildSentryScope } from "./cli/utils/build-sentry-scope.js";
import { SENTRY_DSN, SENTRY_FLUSH_TIMEOUT_MS } from "./cli/utils/constants.js";
import { isEnvFlagEnabled } from "./cli/utils/is-env-flag-enabled.js";
import { isExpectedUserError } from "./cli/utils/is-expected-user-error.js";
import { isTelemetryEnabled } from "./cli/utils/is-telemetry-enabled.js";
import { scrubSentryEvent } from "./cli/utils/scrub-sentry-event.js";
import { resolveSentryEnvironment, resolveSentryRelease } from "./cli/utils/sentry-config.js";

// Re-exported for back-compat: these resolvers moved to `sentry-config.ts` so
// the editor LSP can reuse them without importing this CLI-only module.
export { resolveSentryEnvironment, resolveSentryRelease };

let isInitialized = false;

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
 * crash reporting. Invoked as the first statement of the CLI entry
 * (`cli/index.ts`) so the SDK's global `uncaughtException` /
 * `unhandledRejection` handlers are armed before any command runs.
 *
 * Performance tracing is off: spans are exported to Axiom instead (see
 * `telemetry-runtime.ts`), and Effect has a single `Tracer` reference, so the
 * two backends are mutually exclusive. Sentry keeps what it is good at —
 * symbolicated stack traces, issue grouping, and a quotable event id — while
 * crashes carry the Axiom trace id as a tag so an issue pivots into its trace.
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
 * `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, and `SENTRY_DEBUG`.
 */
export const initializeSentry = (): void => {
  if (isInitialized || !isTelemetryEnabled()) return;
  isInitialized = true;
  const { tags, contexts } = buildSentryScope();
  try {
    Sentry.init({
      dsn: process.env.SENTRY_DSN || SENTRY_DSN,
      release: resolveSentryRelease(),
      environment: resolveSentryEnvironment(),
      // Anonymized telemetry: never attach the user's IP address.
      sendDefaultPii: false,
      // Spans go to Axiom; Sentry captures exceptions only.
      tracesSampleRate: 0,
      debug: isEnvFlagEnabled(process.env.SENTRY_DEBUG),
      // Seed the scope so the run snapshot rides along with every event.
      // (Only `run` exists at init; the scanned `project` context is added later
      // once a scan discovers it.)
      initialScope: { tags, contexts },
      // Anonymize every outgoing event: strip hostname/IP/device identity, drop
      // captured local variables, and scrub home-directory paths and known
      // secrets from all remaining strings. Returns `null` to drop the event if
      // scrubbing fails, so un-anonymized data is never sent.
      beforeSend: (event, hint) =>
        isExpectedUserError(hint.originalException) ? null : scrubSentryEvent(event),
    });
  } catch {}
};
