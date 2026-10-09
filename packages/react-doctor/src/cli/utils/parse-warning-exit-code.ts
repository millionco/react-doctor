import { InvalidArgumentError } from "commander";
import { MAX_WARNING_EXIT_CODE, SCAN_FAILURE_EXIT_CODE } from "./constants.js";

export const parseWarningExitCode = (value: string): number => {
  const exitCode = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isInteger(exitCode) ||
    exitCode <= SCAN_FAILURE_EXIT_CODE ||
    exitCode > MAX_WARNING_EXIT_CODE
  ) {
    throw new InvalidArgumentError(
      `Expected an integer from ${SCAN_FAILURE_EXIT_CODE + 1} to ${MAX_WARNING_EXIT_CODE}.`,
    );
  }
  return exitCode;
};
