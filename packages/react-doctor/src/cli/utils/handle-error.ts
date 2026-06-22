import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  CANONICAL_DISCORD_URL,
  CANONICAL_GITHUB_URL,
  formatErrorChain,
  formatReactDoctorError,
  highlighter,
  isReactDoctorError,
} from "@react-doctor/core";
import type { HandleErrorOptions } from "@react-doctor/core";
import { VERSION } from "./version.js";
import { METRIC } from "./constants.js";
import { formatEnvironmentError, isEnvironmentError } from "./is-environment-error.js";
import { recordCount } from "./record-metric.js";

// `shouldExit` is optional here (defaults to exiting) and the CLI adds a Sentry
// event id, surfaced as a reference the user can quote so we can locate the
// exact crash in Sentry.
interface CliHandleErrorOptions extends Partial<HandleErrorOptions> {
  sentryEventId?: string;
}

const OTLP_ENDPOINT_ENVIRONMENT_VARIABLE = "REACT_DOCTOR_OTLP_ENDPOINT";
const OTLP_AUTH_HEADER_ENVIRONMENT_VARIABLE = "REACT_DOCTOR_OTLP_AUTH_HEADER";

interface ErrorReportContext {
  readonly cwd: string;
  readonly command: string;
  readonly nodeVersion: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: string;
  readonly isOtlpEndpointConfigured: boolean;
  readonly isOtlpAuthHeaderConfigured: boolean;
}

const formatErrorForReport = (error: unknown): string =>
  isReactDoctorError(error) ? formatReactDoctorError(error) : formatErrorChain(error);

const formatSingleLine = (text: string): string => text.replaceAll(/\s+/g, " ").trim();

const getErrorReportContext = (): ErrorReportContext => ({
  cwd: process.cwd(),
  command: process.argv.join(" "),
  nodeVersion: process.version,
  platform: process.platform,
  architecture: process.arch,
  isOtlpEndpointConfigured: Boolean(process.env[OTLP_ENDPOINT_ENVIRONMENT_VARIABLE]),
  isOtlpAuthHeaderConfigured: Boolean(process.env[OTLP_AUTH_HEADER_ENVIRONMENT_VARIABLE]),
});

const formatConfiguredState = (isConfigured: boolean): string => (isConfigured ? "yes" : "no");

const buildErrorIssueBody = (
  error: unknown,
  context: ErrorReportContext,
  sentryEventId: string | undefined,
): string => {
  const formattedError = formatErrorForReport(error) || "(empty error)";
  const isOtlpExporterEnabled =
    context.isOtlpEndpointConfigured && context.isOtlpAuthHeaderConfigured;

  return [
    "## Error",
    "",
    "```text",
    formattedError,
    "```",
    "",
    "## Runtime",
    "",
    `- react-doctor version: ${VERSION}`,
    `- node: ${context.nodeVersion}`,
    `- platform: ${context.platform} ${context.architecture}`,
    `- cwd: ${context.cwd}`,
    `- command: ${context.command}`,
    ...(sentryEventId ? [`- Sentry reference: ${sentryEventId}`] : []),
    "",
    "## OpenTelemetry",
    "",
    `- ${OTLP_ENDPOINT_ENVIRONMENT_VARIABLE} configured: ${formatConfiguredState(context.isOtlpEndpointConfigured)}`,
    `- ${OTLP_AUTH_HEADER_ENVIRONMENT_VARIABLE} configured: ${formatConfiguredState(context.isOtlpAuthHeaderConfigured)} (value redacted)`,
    `- OTLP exporter enabled: ${formatConfiguredState(isOtlpExporterEnabled)}`,
    "- trace/span link, if exported: ",
    "",
    "## Notes",
    "",
    "Please add reproduction steps and any relevant repository details.",
  ].join("\n");
};

export const buildErrorIssueUrl = (error: unknown, sentryEventId?: string): string => {
  const formattedError = formatSingleLine(formatErrorForReport(error));
  const issueUrl = new URL(`${CANONICAL_GITHUB_URL}/issues/new`);
  issueUrl.searchParams.set("title", formattedError ? `CLI error: ${formattedError}` : "CLI error");
  issueUrl.searchParams.set("labels", "bug");
  issueUrl.searchParams.set(
    "body",
    buildErrorIssueBody(error, getErrorReportContext(), sentryEventId),
  );
  return issueUrl.toString();
};

/**
 * Effect-typed renderer: every message routes through `Console.error`
 * so test runs can swap `Console` to a capture sink and the output
 * appears in the right stream (stderr) in production. Lines stay
 * red-highlighted (matches the historical `consoleLogger.error`
 * contract) so the user sees a clearly distinguished error block.
 */
const handleErrorEffect = (
  error: unknown,
  sentryEventId: string | undefined,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Console.error("");
    yield* Console.error(
      highlighter.error("Something went wrong. Please check the error below for more details."),
    );
    yield* Console.error(
      highlighter.error(
        `If the problem persists, please open this prefilled issue: ${buildErrorIssueUrl(error, sentryEventId)}`,
      ),
    );
    yield* Console.error(
      highlighter.error(`You can also ask for help in Discord: ${CANONICAL_DISCORD_URL}`),
    );
    if (sentryEventId) {
      yield* Console.error(
        highlighter.error(`Reference (mention this when reporting): ${sentryEventId}`),
      );
    }
    yield* Console.error("");
    yield* Console.error(highlighter.error(formatErrorForReport(error)));
    yield* Console.error("");
  });

/**
 * Sync façade for legacy callers (top-level CLI command bodies that
 * aren't yet Effect-typed). Bridges via `Effect.runSync` so the
 * underlying Console writes happen exactly like the Effect path.
 */
export const handleError = (error: unknown, options: CliHandleErrorOptions = {}): void => {
  Effect.runSync(handleErrorEffect(error, options.sentryEventId));
  if (options.shouldExit !== false) {
    process.exit(1);
  }
  process.exitCode = 1;
};

/**
 * Renderer for expected, user-actionable failures — a bad `--diff` value,
 * a base branch that isn't fetched, or environment errors like disk-full or
 * permission-denied. Prints just the (already human-readable) message — no
 * "Something went wrong", prefilled issue, Discord link, or Sentry reference
 * — because there is no bug to report.
 */
export const handleUserError = (error: unknown, options: { shouldExit?: boolean } = {}): void => {
  const isEnvError = isEnvironmentError(error);
  if (isEnvError) {
    // Environment errors are dropped from Sentry (the user's machine, not our
    // bug), so a low-cardinality counter keyed by code keeps the failure rate
    // visible. `recordCount` no-ops unless Sentry is initialized, and its
    // `withRunAttributes` already tags the command — only the code is passed.
    recordCount(METRIC.cliEnvironmentError, 1, {
      code: (error as NodeJS.ErrnoException).code ?? "unknown",
    });
  }
  const message = isEnvError ? formatEnvironmentError(error) : formatErrorForReport(error);

  Effect.runSync(
    Effect.gen(function* () {
      yield* Console.error("");
      yield* Console.error(highlighter.error(message));
      yield* Console.error("");
    }),
  );
  if (options.shouldExit !== false) {
    process.exit(1);
  }
  process.exitCode = 1;
};
