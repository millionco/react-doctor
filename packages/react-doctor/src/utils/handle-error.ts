import { logger } from "./logger.js";
import type { HandleErrorOptions } from "../types.js";

const DEFAULT_HANDLE_ERROR_OPTIONS: HandleErrorOptions = {
  shouldExit: true,
};

export const handleError = (
  error: unknown,
  options: HandleErrorOptions = DEFAULT_HANDLE_ERROR_OPTIONS,
): void => {
  logger.break();
  logger.error("Something went wrong. Please check the error below for more details.");
  logger.error("If the problem persists, please open an issue on GitHub.");
  logger.error("");
  if (error instanceof Error) {
    logger.error(error.message);
  }
  logger.break();
  if (options.shouldExit) {
    process.exit(1);
  }
  process.exitCode = 1;
};
