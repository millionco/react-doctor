const INVALID_REPORT_MESSAGE = "React Doctor returned an invalid JSON report";
const UNSUCCESSFUL_REPORT_MESSAGE = "React Doctor returned an unsuccessful JSON report";

export const parseReactDoctorReport = (output: string): unknown => {
  const report: unknown = JSON.parse(output);
  if (typeof report !== "object" || report === null || !("ok" in report)) {
    throw new Error(INVALID_REPORT_MESSAGE);
  }
  if (report.ok === true) return report;

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
};
