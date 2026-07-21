import { isDeepStrictEqual } from "node:util";

import {
  REACT_DOCTOR_BASELINE_REPORT_SCHEMA_VERSION,
  REACT_DOCTOR_COMPLETE_REPORT_SCHEMA_VERSION,
  REACT_DOCTOR_REPORT_FRAMEWORKS,
  REACT_DOCTOR_REPORT_MODES,
  REACT_DOCTOR_REPORT_SCHEMA_VERSIONS,
  SUCCESS_EXIT_CODE,
} from "../constants.js";
import { toErrorMessage } from "./to-error-message.js";

interface UnknownRecord {
  [key: string]: unknown;
}

const INVALID_REPORT_MESSAGE = "React Doctor returned an invalid JSON report";
const UNSUCCESSFUL_REPORT_MESSAGE = "React Doctor returned an unsuccessful JSON report";
const NONZERO_SUCCESSFUL_REPORT_MESSAGE =
  "React Doctor returned a successful JSON report with a nonzero exit code";

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteNonnegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");

const isValidDiagnostic = (value: unknown, schemaVersion: number): boolean => {
  if (!isRecord(value)) return false;
  if (
    typeof value.filePath !== "string" ||
    typeof value.plugin !== "string" ||
    typeof value.rule !== "string" ||
    (value.severity !== "error" && value.severity !== "warning") ||
    typeof value.message !== "string" ||
    typeof value.help !== "string" ||
    typeof value.category !== "string" ||
    !isFiniteNonnegativeNumber(value.line) ||
    !isFiniteNonnegativeNumber(value.column)
  ) {
    return false;
  }
  return (
    schemaVersion !== REACT_DOCTOR_COMPLETE_REPORT_SCHEMA_VERSION ||
    (typeof value.id === "string" &&
      typeof value.normalizedFilePath === "string" &&
      isStringArray(value.tags))
  );
};

const isValidProject = (value: unknown, schemaVersion: number): boolean => {
  if (
    !isRecord(value) ||
    typeof value.directory !== "string" ||
    !Array.isArray(value.diagnostics) ||
    !value.diagnostics.every((diagnostic) => isValidDiagnostic(diagnostic, schemaVersion)) ||
    !isStringArray(value.skippedChecks) ||
    !Object.hasOwn(value, "project") ||
    !Object.hasOwn(value, "score") ||
    (value.scannedFileCount !== undefined &&
      (!Number.isInteger(value.scannedFileCount) ||
        !isFiniteNonnegativeNumber(value.scannedFileCount))) ||
    !isFiniteNonnegativeNumber(value.elapsedMilliseconds)
  ) {
    return false;
  }
  const skippedCheckReasons = value.skippedCheckReasons;
  if (
    skippedCheckReasons !== undefined &&
    (!isRecord(skippedCheckReasons) ||
      !Object.values(skippedCheckReasons).every((reason) => typeof reason === "string"))
  ) {
    return false;
  }
  const skippedCheckReasonCount = Object.keys(skippedCheckReasons ?? {}).length;
  if (schemaVersion !== REACT_DOCTOR_COMPLETE_REPORT_SCHEMA_VERSION) {
    return value.skippedChecks.length === 0 && skippedCheckReasonCount === 0;
  }
  return (
    typeof value.packageRoot === "string" &&
    typeof value.framework === "string" &&
    REACT_DOCTOR_REPORT_FRAMEWORKS.has(value.framework) &&
    value.complete === true &&
    value.skippedChecks.length === 0 &&
    skippedCheckReasonCount === 0 &&
    isStringArray(value.analyzedFiles) &&
    Number.isInteger(value.analyzedFileCount) &&
    value.analyzedFileCount === value.analyzedFiles.length &&
    (value.scannedFileCount === undefined || value.scannedFileCount === value.analyzedFileCount)
  );
};

const isValidSummary = (value: unknown, diagnostics: ReadonlyArray<unknown>): boolean => {
  if (!isRecord(value)) return false;
  const errorCount = diagnostics.filter(
    (diagnostic) => isRecord(diagnostic) && diagnostic.severity === "error",
  ).length;
  const warningCount = diagnostics.filter(
    (diagnostic) => isRecord(diagnostic) && diagnostic.severity === "warning",
  ).length;
  return (
    value.errorCount === errorCount &&
    value.warningCount === warningCount &&
    Number.isInteger(value.affectedFileCount) &&
    isFiniteNonnegativeNumber(value.affectedFileCount) &&
    value.totalDiagnosticCount === diagnostics.length &&
    (value.score === null || isFiniteNonnegativeNumber(value.score)) &&
    (value.scoreLabel === null || typeof value.scoreLabel === "string")
  );
};

const isValidDiff = (value: unknown): boolean =>
  value === null ||
  (isRecord(value) &&
    typeof value.baseBranch === "string" &&
    (value.currentBranch === null || typeof value.currentBranch === "string") &&
    Number.isInteger(value.changedFileCount) &&
    isFiniteNonnegativeNumber(value.changedFileCount) &&
    typeof value.isCurrentChanges === "boolean");

const isValidBaseline = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.baseRef === "string" &&
  Number.isInteger(value.newCount) &&
  isFiniteNonnegativeNumber(value.newCount) &&
  Number.isInteger(value.fixedCount) &&
  isFiniteNonnegativeNumber(value.fixedCount) &&
  Number.isInteger(value.baseTotalCount) &&
  isFiniteNonnegativeNumber(value.baseTotalCount);

const isValidSuccessfulReport = (report: UnknownRecord): boolean => {
  const schemaVersion = report.schemaVersion;
  if (
    report.ok !== true ||
    typeof schemaVersion !== "number" ||
    !REACT_DOCTOR_REPORT_SCHEMA_VERSIONS.has(schemaVersion) ||
    typeof report.version !== "string" ||
    typeof report.directory !== "string" ||
    typeof report.mode !== "string" ||
    !REACT_DOCTOR_REPORT_MODES.has(report.mode) ||
    !Object.hasOwn(report, "diff") ||
    !isValidDiff(report.diff) ||
    !Array.isArray(report.projects) ||
    report.projects.length === 0 ||
    !Array.isArray(report.diagnostics) ||
    !isFiniteNonnegativeNumber(report.elapsedMilliseconds) ||
    report.error !== null
  ) {
    return false;
  }
  if (
    schemaVersion === REACT_DOCTOR_BASELINE_REPORT_SCHEMA_VERSION &&
    !isValidBaseline(report.baseline)
  ) {
    return false;
  }
  if (
    schemaVersion === REACT_DOCTOR_COMPLETE_REPORT_SCHEMA_VERSION &&
    report.baseline !== undefined &&
    !isValidBaseline(report.baseline)
  ) {
    return false;
  }
  if (
    !report.projects.every((project) => isValidProject(project, schemaVersion)) ||
    !report.diagnostics.every((diagnostic) => isValidDiagnostic(diagnostic, schemaVersion)) ||
    !isValidSummary(report.summary, report.diagnostics)
  ) {
    return false;
  }
  const projectDiagnostics = report.projects.flatMap((project) =>
    isRecord(project) && Array.isArray(project.diagnostics) ? project.diagnostics : [],
  );
  return isDeepStrictEqual(projectDiagnostics, report.diagnostics);
};

export const parseReactDoctorReport = (
  output: string,
  exitCode = SUCCESS_EXIT_CODE,
): UnknownRecord => {
  try {
    const report: unknown = JSON.parse(output);
    if (!isRecord(report) || !("ok" in report)) {
      throw new Error(INVALID_REPORT_MESSAGE);
    }
    if (report.ok === true) {
      if (!isValidSuccessfulReport(report)) throw new Error(INVALID_REPORT_MESSAGE);
      if (exitCode !== SUCCESS_EXIT_CODE) throw new Error(NONZERO_SUCCESSFUL_REPORT_MESSAGE);
      return report;
    }

    let errorMessage = UNSUCCESSFUL_REPORT_MESSAGE;
    if (
      "error" in report &&
      isRecord(report.error) &&
      "message" in report.error &&
      typeof report.error.message === "string"
    ) {
      errorMessage = report.error.message;
    }
    throw new Error(errorMessage);
  } catch (error) {
    if (exitCode === SUCCESS_EXIT_CODE) throw error;
    const commandOutput = output.trim();
    const outputDetails = commandOutput === "" ? "" : `\n${commandOutput}`;
    throw new Error(
      `React Doctor exited with code ${exitCode}: ${toErrorMessage(error)}${outputDetails}`,
    );
  }
};
