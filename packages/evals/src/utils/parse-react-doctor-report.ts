import { SUCCESS_EXIT_CODE } from "../constants.js";
import { toErrorMessage } from "./to-error-message.js";

const INVALID_REPORT_MESSAGE = "React Doctor returned an invalid JSON report";
const UNSUCCESSFUL_REPORT_MESSAGE = "React Doctor returned an unsuccessful JSON report";
const INCOMPLETE_REPORT_MESSAGE = "React Doctor skipped the lint check";

export const parseReactDoctorReport = (output: string, exitCode = SUCCESS_EXIT_CODE): unknown => {
  try {
    const report: unknown = JSON.parse(output);
    if (typeof report !== "object" || report === null || !("ok" in report)) {
      throw new Error(INVALID_REPORT_MESSAGE);
    }
    if (report.ok === true) {
      if (
        "projects" in report &&
        Array.isArray(report.projects) &&
        report.projects.some(
          (project) =>
            typeof project === "object" &&
            project !== null &&
            "skippedChecks" in project &&
            Array.isArray(project.skippedChecks) &&
            project.skippedChecks.includes("lint"),
        )
      ) {
        throw new Error(INCOMPLETE_REPORT_MESSAGE);
      }
      return report;
    }

    let errorMessage = UNSUCCESSFUL_REPORT_MESSAGE;
    if (
      "error" in report &&
      typeof report.error === "object" &&
      report.error !== null &&
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
