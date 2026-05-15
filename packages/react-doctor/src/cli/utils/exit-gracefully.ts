import { logger } from "@react-doctor/core";
import { SIGINT_EXIT_CODE } from "./constants.js";
import { isJsonModeActive, writeJsonErrorReport } from "./json-mode.js";

export const exitGracefully = (): void => {
  if (isJsonModeActive()) {
    writeJsonErrorReport(new Error("Scan cancelled by user (SIGINT/SIGTERM)"));
    process.exit(SIGINT_EXIT_CODE);
  }
  logger.break();
  logger.log("Cancelled.");
  logger.break();
  process.exit(SIGINT_EXIT_CODE);
};
