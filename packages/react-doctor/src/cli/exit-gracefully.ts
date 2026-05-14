import { performance } from "node:perf_hooks";
import { buildJsonReportError } from "../core/build-json-report-error.js";
import { logger } from "../core/logger.js";
import { cliState } from "./cli-state.js";
import { VERSION } from "./version.js";
import { writeJsonReport } from "./write-json-report.js";

export const exitGracefully = (): void => {
  if (cliState.isJsonModeActive) {
    writeJsonReport(
      buildJsonReportError({
        version: VERSION,
        directory: cliState.resolvedDirectoryForCancel ?? process.cwd(),
        error: new Error("Scan cancelled by user (SIGINT/SIGTERM)"),
        elapsedMilliseconds: performance.now() - cliState.cancelStartTime,
        mode: cliState.currentReportMode,
      }),
    );
    process.exit(130);
  }
  logger.break();
  logger.log("Cancelled.");
  logger.break();
  process.exit(130);
};
