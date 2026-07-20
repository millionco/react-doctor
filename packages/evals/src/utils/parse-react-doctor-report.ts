import {
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

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const isValidSuccessfulReport = (report: UnknownRecord): boolean =>
  report.ok === true &&
  typeof report.schemaVersion === "number" &&
  REACT_DOCTOR_REPORT_SCHEMA_VERSIONS.has(report.schemaVersion) &&
  typeof report.version === "string" &&
  typeof report.directory === "string" &&
  typeof report.mode === "string" &&
  REACT_DOCTOR_REPORT_MODES.has(report.mode) &&
  Array.isArray(report.projects) &&
  Array.isArray(report.diagnostics) &&
  isRecord(report.summary) &&
  typeof report.elapsedMilliseconds === "number" &&
  report.error === null;

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
