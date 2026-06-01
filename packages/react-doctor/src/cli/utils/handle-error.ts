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

const buildErrorIssueBody = (error: unknown, context: ErrorReportContext): string => {
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

export const buildErrorIssueUrl = (error: unknown): string => {
  const formattedError = formatSingleLine(formatErrorForReport(error));
  const issueUrl = new URL(`${CANONICAL_GITHUB_URL}/issues/new`);
  issueUrl.searchParams.set("title", formattedError ? `CLI error: ${formattedError}` : "CLI error");
  issueUrl.searchParams.set("labels", "bug");
  issueUrl.searchParams.set("body", buildErrorIssueBody(error, getErrorReportContext()));
  return issueUrl.toString();
};

/**
 * Effect-typed renderer: every message routes through `Console.error`
 * so test runs can swap `Console` to a capture sink and the output
 * appears in the right stream (stderr) in production. Lines stay
 * red-highlighted (matches the historical `consoleLogger.error`
 * contract) so the user sees a clearly distinguished error block.
 */
const handleErrorEffect = (error: unknown): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Console.error("");
    yield* Console.error(
      highlighter.error("Something went wrong. Please check the error below for more details."),
    );
    yield* Console.error(
      highlighter.error(
        `If the problem persists, please open this prefilled issue: ${buildErrorIssueUrl(error)}`,
      ),
    );
    yield* Console.error(
      highlighter.error(`You can also ask for help in Discord: ${CANONICAL_DISCORD_URL}`),
    );
    yield* Console.error("");
    yield* Console.error(highlighter.error(formatErrorForReport(error)));
    yield* Console.error("");
  });

/**
 * Sync façade for legacy callers (top-level CLI command bodies that
 * aren't yet Effect-typed). Bridges via `Effect.runSync` so the
 * underlying Console writes happen exactly like the Effect path.
 */
export const handleError = (
  error: unknown,
  options: HandleErrorOptions = { shouldExit: true },
): void => {
  Effect.runSync(handleErrorEffect(error));
  if (options.shouldExit !== false) {
    process.exit(1);
  }
  process.exitCode = 1;
};
