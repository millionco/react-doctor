import { BETTER_STACK_ERROR_TRACKING_DSN, ERROR_TRACKING_FLUSH_TIMEOUT_MS } from "./constants.js";
import {
  CI_ENVIRONMENT_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VARIABLES,
  isCiEnvironment,
  isCodingAgentEnvironment,
} from "./is-ci-environment.js";
import { isJsonModeActive } from "./json-mode.js";
import { VERSION } from "./version.js";

const ERROR_REPORTING_ENV_VARIABLE = "REACT_DOCTOR_ERROR_REPORTING";
const OTLP_ENDPOINT_ENVIRONMENT_VARIABLE = "REACT_DOCTOR_OTLP_ENDPOINT";
const OTLP_AUTH_HEADER_ENVIRONMENT_VARIABLE = "REACT_DOCTOR_OTLP_AUTH_HEADER";

// Where the error surfaced from, so a Better Stack triager can tell a
// gracefully-handled command failure apart from a true crash that
// escaped every try/catch.
export type ErrorReportOrigin =
  | "command"
  | "top-level"
  | "uncaughtException"
  | "unhandledRejection";

type SentryNode = typeof import("@sentry/node");

let sentryClient: SentryNode | null = null;

const isErrorReportingEnabled = (): boolean => {
  const optInValue = process.env[ERROR_REPORTING_ENV_VARIABLE];
  return optInValue === "1" || optInValue === "true";
};

// `process.cwd()` throws (ENOENT) if the working directory was deleted
// out from under the process — guard it so building the report never
// becomes the reason the report is lost.
const safeCwd = (): string => {
  try {
    return process.cwd();
  } catch {
    return "(unavailable)";
  }
};

// Which CI provider, if any — the specific canonical marker, falling back
// to the generic `CI=true` signal.
const detectCiProvider = (): string | null => {
  const matched = CI_ENVIRONMENT_VARIABLES.find((envVariable) => Boolean(process.env[envVariable]));
  if (matched) return matched;
  return process.env.CI === "true" ? "generic" : null;
};

// Which coding-agent runtime, if any. Env-var presence is enough of a
// signal and is cheap + synchronous, unlike the filesystem agent scan in
// detect-agents.ts (which we must not run on the crash path).
const detectCodingAgent = (): string | null => {
  const matched = CODING_AGENT_ENVIRONMENT_VARIABLES.find((envVariable) =>
    Boolean(process.env[envVariable]),
  );
  if (matched) return matched;
  return isCodingAgentEnvironment() ? "other" : null;
};

// `install` / `setup` vs the default `inspect` action, derived from argv.
const detectInvokedCommand = (): string => {
  const commandArguments = process.argv.slice(2);
  return commandArguments.includes("install") || commandArguments.includes("setup")
    ? "install"
    : "inspect";
};

/**
 * Everything we know about the run that helps debug a crash: searchable
 * tags (filter Better Stack by `ci`, `platform`, `origin`, …) plus a
 * structured `react-doctor` context block with the fuller picture. The
 * user opted in, so this mirrors what the prefilled GitHub issue already
 * surfaces (cwd, command, runtime) — never source code.
 */
const buildCaptureContext = (origin: ErrorReportOrigin) => {
  const isCi = isCiEnvironment();
  const ciProvider = detectCiProvider();
  const codingAgent = detectCodingAgent();
  const command = detectInvokedCommand();
  const isInteractive = Boolean(process.stdout.isTTY);
  const isOtlpEndpointConfigured = Boolean(process.env[OTLP_ENDPOINT_ENVIRONMENT_VARIABLE]);
  const isOtlpAuthHeaderConfigured = Boolean(process.env[OTLP_AUTH_HEADER_ENVIRONMENT_VARIABLE]);

  return {
    tags: {
      origin,
      command,
      ci: isCi,
      "ci.provider": ciProvider ?? "none",
      coding_agent: codingAgent ?? "none",
      json_mode: isJsonModeActive(),
      interactive: isInteractive,
      "node.version": process.version,
      platform: process.platform,
      arch: process.arch,
    },
    contexts: {
      "react-doctor": {
        version: VERSION,
        origin,
        command,
        argv: process.argv.slice(2).join(" "),
        cwd: safeCwd(),
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        ci: isCi,
        ciProvider: ciProvider ?? null,
        codingAgent: codingAgent ?? null,
        interactive: isInteractive,
        jsonMode: isJsonModeActive(),
        otlpEndpointConfigured: isOtlpEndpointConfigured,
        otlpAuthHeaderConfigured: isOtlpAuthHeaderConfigured,
      },
    },
  };
};

/**
 * Opt-in crash reporting to Better Stack (via the Sentry SDK). Mirrors
 * the strictly-opt-in posture of `layerOtlp` in `@react-doctor/core` —
 * nothing leaves the machine unless the user sets
 * `REACT_DOCTOR_ERROR_REPORTING=1`. When disabled, `@sentry/node` is
 * never imported, so the common (non-opted-in) run pays zero cost.
 *
 * The DSN is a public ingest key baked into the build; the env var is
 * the consent gate. Stack traces resolve to original TypeScript because
 * `sentry-cli sourcemaps inject` stamps debug IDs into `dist` during the
 * production build and `.github/workflows/publish.yml` uploads the
 * matching source maps to Better Stack at publish time.
 */
export const initErrorTracking = async (): Promise<void> => {
  if (sentryClient || !isErrorReportingEnabled()) return;
  try {
    const Sentry = await import("@sentry/node");
    Sentry.init({
      dsn: BETTER_STACK_ERROR_TRACKING_DSN,
      release: `react-doctor@${VERSION}`,
      // Error capture only: no tracing, no auto-instrumentation, and no
      // global process handlers. The CLI owns its own SIGINT / SIGTERM /
      // EPIPE / exit handling (see index.ts + exit-gracefully.ts) and
      // must not have Sentry's default handlers race it.
      defaultIntegrations: false,
      skipOpenTelemetrySetup: true,
    });
    sentryClient = Sentry;
  } catch {
    // Crash reporting must never break the CLI.
    sentryClient = null;
  }
};

/**
 * Reports a fatal CLI error to Better Stack — tagged with where it came
 * from (CI vs local, which command, which runtime) — and waits for it to
 * flush before the caller exits. A no-op when reporting is disabled.
 */
export const captureCliError = async (
  error: unknown,
  origin: ErrorReportOrigin = "top-level",
): Promise<void> => {
  if (!sentryClient) return;
  try {
    sentryClient.captureException(error, buildCaptureContext(origin));
    await sentryClient.flush(ERROR_TRACKING_FLUSH_TIMEOUT_MS);
  } catch {
    // Swallow — a reporting failure must not mask the original error.
  }
};
