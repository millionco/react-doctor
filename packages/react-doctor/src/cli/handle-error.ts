import { CANONICAL_GITHUB_URL } from "../constants.js";
import type { HandleErrorOptions } from "../types/handle-error.js";
import { formatErrorChain } from "../core/format-error-chain.js";
import { logger } from "../core/logger.js";

const DEFAULT_HANDLE_ERROR_OPTIONS: HandleErrorOptions = {
  shouldExit: true,
};

export const handleError = (
  error: unknown,
  options: HandleErrorOptions = DEFAULT_HANDLE_ERROR_OPTIONS,
): void => {
  logger.break();
  logger.error("Something went wrong. Please check the error below for more details.");
  logger.error(`If the problem persists, please open an issue at ${CANONICAL_GITHUB_URL}/issues.`);
  logger.error("");
  logger.error(formatErrorChain(error));
  logger.break();
  if (options.shouldExit) {
    process.exit(1);
  }
  process.exitCode = 1;
};
