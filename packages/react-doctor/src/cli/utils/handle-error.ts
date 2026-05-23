import {
  CANONICAL_GITHUB_URL,
  consoleLogger,
  formatErrorChain,
  formatReactDoctorError,
  isReactDoctorError,
  type LoggerWriter,
} from "@react-doctor/core";
import type { HandleErrorOptions } from "@react-doctor/types";

interface HandleErrorInput {
  readonly logger?: LoggerWriter;
  readonly shouldExit?: boolean;
}

export const handleError = (
  error: unknown,
  options: HandleErrorOptions | HandleErrorInput = { shouldExit: true },
): void => {
  const logger: LoggerWriter =
    "logger" in options && options.logger !== undefined ? options.logger : consoleLogger;
  logger.break();
  logger.error("Something went wrong. Please check the error below for more details.");
  logger.error(`If the problem persists, please open an issue at ${CANONICAL_GITHUB_URL}/issues.`);
  logger.error("");
  logger.error(isReactDoctorError(error) ? formatReactDoctorError(error) : formatErrorChain(error));
  logger.break();
  if (options.shouldExit !== false) {
    process.exit(1);
  }
  process.exitCode = 1;
};
