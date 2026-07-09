import {
  METRIC,
  COMPLEXITY_COMMAND_DEFAULT_MIN_CYCLOMATIC,
  COMPLEXITY_COMMAND_DEFAULT_TOP_COUNT,
} from "../utils/constants.js";
import { CliInputError } from "../utils/cli-input-error.js";
import { handleError, handleUserError } from "../utils/handle-error.js";
import { isExpectedUserError } from "../utils/is-expected-user-error.js";
import { recordCount } from "../utils/record-metric.js";
import { reportErrorToSentry } from "../utils/report-error.js";
import {
  buildComplexityReport,
  getComplexityHeadlineScore,
  getComplexityScoreBand,
} from "../utils/complexity-report.js";
import { renderComplexityReport } from "../utils/render-complexity.js";
import type { ComplexitySortMetric } from "../utils/complexity-report.js";

interface ComplexityCommandOptions {
  readonly json?: boolean;
  readonly diff?: string;
  readonly top?: string;
  readonly sort?: string;
  readonly min?: string;
}

const parsePositiveInteger = (
  inputValue: string | undefined,
  fallbackValue: number,
  label: string,
  minimumValue: number,
): number => {
  if (inputValue === undefined) return fallbackValue;
  const parsedValue = Number.parseInt(inputValue, 10);
  if (!Number.isInteger(parsedValue) || parsedValue < minimumValue) {
    throw new CliInputError(
      `Invalid --${label} "${inputValue}". Expected an integer >= ${minimumValue}.`,
    );
  }
  return parsedValue;
};

const resolveSortMetric = (inputValue: string | undefined): ComplexitySortMetric => {
  if (inputValue === undefined) return "cyclomatic";
  if (inputValue === "cyclomatic" || inputValue === "cognitive") return inputValue;
  throw new CliInputError(`Invalid --sort "${inputValue}". Expected "cyclomatic" or "cognitive".`);
};

export const complexityAction = async (
  directory: string,
  options: ComplexityCommandOptions,
): Promise<void> => {
  try {
    const sortMetric = resolveSortMetric(options.sort);
    const parsedTop = parsePositiveInteger(
      options.top,
      COMPLEXITY_COMMAND_DEFAULT_TOP_COUNT,
      "top",
      1,
    );
    const top = options.json ? null : parsedTop;
    const minCyclomatic = parsePositiveInteger(
      options.min,
      COMPLEXITY_COMMAND_DEFAULT_MIN_CYCLOMATIC,
      "min",
      1,
    );

    const report = await buildComplexityReport({
      directory,
      diffRef: options.diff ?? null,
      sortMetric,
      minCyclomatic,
      top,
    });
    recordCount(METRIC.complexityCommandInvoked, 1, {
      mode: options.diff === undefined ? "full" : "diff",
      scoreBand: getComplexityScoreBand(getComplexityHeadlineScore(report)),
    });
    if (options.json === true) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    process.stdout.write(`${renderComplexityReport(report)}\n`);
  } catch (error) {
    if (isExpectedUserError(error)) {
      handleUserError(error);
      return;
    }
    const sentryEventId = await reportErrorToSentry(error);
    handleError(error, { sentryEventId });
  }
};
