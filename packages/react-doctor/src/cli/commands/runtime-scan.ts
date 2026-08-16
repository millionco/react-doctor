import { buildRuntimeScanReport } from "../runtime-scan/build-runtime-scan-report.js";
import { RUNTIME_SCAN_SCHEMA_VERSION } from "../runtime-scan/constants.js";
import { formatRuntimeScanReport } from "../runtime-scan/format-runtime-scan-report.js";
import { recordRuntimeTrace } from "../runtime-scan/record-runtime-trace.js";
import { resolveRuntimeScanFormat } from "../runtime-scan/resolve-runtime-scan-format.js";
import type { RuntimeScanFlags } from "../runtime-scan/types.js";
import { CliInputError } from "../utils/cli-input-error.js";
import { METRIC } from "../utils/constants.js";
import { recordCount } from "../utils/record-metric.js";
import { reportErrorToSentry } from "../utils/report-error.js";

export const runtimeScanAction = async (url: string, flags: RuntimeScanFlags): Promise<void> => {
  const format = resolveRuntimeScanFormat(flags.format);
  recordCount(METRIC.cliInvoked, 1, { command: "scan" });
  try {
    const capture = await recordRuntimeTrace({
      url,
      traceOut: flags.traceOut,
      cdpUrl: flags.cdp,
    });
    const report = buildRuntimeScanReport({
      requestedUrl: url,
      tracePath: capture.tracePath,
      capturedAt: capture.capturedAt,
      durationMs: capture.durationMs,
      snapshot: capture.snapshot,
      connection: capture.connection,
    });
    process.stdout.write(formatRuntimeScanReport(report, format));
  } catch (error) {
    if (format === "text") throw error;
    const sentryEventId =
      error instanceof CliInputError ? undefined : await reportErrorToSentry(error);
    const errorReport = {
      schemaVersion: RUNTIME_SCAN_SCHEMA_VERSION,
      kind: "react-doctor-runtime-scan-error",
      error: {
        message:
          error instanceof CliInputError
            ? error.message
            : "Runtime scan failed. Use the error reference when reporting this issue.",
        sentryEventId,
      },
    };
    process.stdout.write(
      format === "json"
        ? `${JSON.stringify(errorReport, null, 2)}\n`
        : `${JSON.stringify({ ...errorReport, kind: "error" })}\n`,
    );
    process.exitCode = 1;
  }
};
