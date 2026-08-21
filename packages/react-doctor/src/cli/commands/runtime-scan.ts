import { buildRuntimeScanReport } from "../runtime-scan/build-runtime-scan-report.js";
import { RUNTIME_SCAN_SCHEMA_VERSION } from "../runtime-scan/constants.js";
import { formatRuntimeScanReport } from "../runtime-scan/format-runtime-scan-report.js";
import { recordRuntimeTrace } from "../runtime-scan/record-runtime-trace.js";
import { resolveRuntimeScanFormat } from "../runtime-scan/resolve-runtime-scan-format.js";
import type { RuntimeScanFlags } from "../runtime-scan/types.js";
import { CliInputError } from "../utils/cli-input-error.js";
import { METRIC } from "../utils/constants.js";
import { enableJsonMode } from "../utils/json-mode.js";
import { recordCount } from "../utils/record-metric.js";
import { reportErrorToSentry } from "../utils/report-error.js";
import { resolveTuiEnvironment } from "../utils/resolve-tui-environment.js";
import { isTuiEnvironmentSupported } from "../utils/should-use-tui.js";
import { resetSentryRunState, withRunSpan } from "../utils/with-run-span.js";

const writeRuntimeScanErrorReport = (
  format: "json" | "jsonl",
  message: string,
  sentryEventId?: string,
): void => {
  const errorReport = {
    schemaVersion: RUNTIME_SCAN_SCHEMA_VERSION,
    kind: "react-doctor-runtime-scan-error",
    error: {
      message,
      sentryEventId,
    },
  };
  process.stdout.write(
    format === "json"
      ? `${JSON.stringify(errorReport, null, 2)}\n`
      : `${JSON.stringify({ ...errorReport, kind: "error" })}\n`,
  );
};

const resolveRuntimeScanUrl = async (url: string | undefined): Promise<string | null> => {
  if (url !== undefined) return url;
  const tuiEnvironment = resolveTuiEnvironment(process.stderr.isTTY === true);
  if (!isTuiEnvironmentSupported(tuiEnvironment)) {
    throw new CliInputError(
      "A URL is required outside an interactive terminal. Run `react-doctor scan <url>`.",
    );
  }
  recordCount(METRIC.runtimeScanUrlPromptShown);
  const { promptRuntimeScanUrl } = await import("../ink/prompt-runtime-scan-url.js");
  return promptRuntimeScanUrl();
};

export const runtimeScanAction = async (
  url: string | undefined,
  flags: RuntimeScanFlags,
): Promise<void> => {
  const format = resolveRuntimeScanFormat(flags.format);
  if (format !== "text") {
    enableJsonMode({
      compact: format === "jsonl",
      directory: process.cwd(),
      writeCancellationError: () => {
        writeRuntimeScanErrorReport(format, "Runtime scan cancelled by user.");
      },
    });
  }
  recordCount(METRIC.cliInvoked, 1, { command: "scan" });
  resetSentryRunState();
  try {
    const resolvedUrl = await resolveRuntimeScanUrl(url);
    if (resolvedUrl === null) {
      resetSentryRunState();
      return;
    }
    await withRunSpan(
      async () => {
        const capture = await recordRuntimeTrace({
          url: resolvedUrl,
          traceOut: flags.traceOut,
          cdpUrl: flags.cdp,
        });
        const report = buildRuntimeScanReport({
          requestedUrl: resolvedUrl,
          tracePath: capture.tracePath,
          capturedAt: capture.capturedAt,
          durationMs: capture.durationMs,
          snapshot: capture.snapshot,
          connection: capture.connection,
        });
        process.stdout.write(formatRuntimeScanReport(report, format));
      },
      {
        mapErrorForSpan: (error) =>
          new Error(
            error instanceof CliInputError ? "Runtime scan input failed." : "Runtime scan failed.",
          ),
      },
    );
    resetSentryRunState();
  } catch (error) {
    if (format === "text") throw error;
    const sentryEventId =
      error instanceof CliInputError ? undefined : await reportErrorToSentry(error);
    writeRuntimeScanErrorReport(
      format,
      error instanceof CliInputError
        ? error.message
        : "Runtime scan failed. Use the error reference when reporting this issue.",
      sentryEventId,
    );
    process.exitCode = 1;
  }
};
