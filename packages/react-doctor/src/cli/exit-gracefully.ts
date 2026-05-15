import { performance } from "node:perf_hooks";
import { buildJsonReportError, logger } from "@react-doctor/core";
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
