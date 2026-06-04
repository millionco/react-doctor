import { CANONICAL_GITHUB_URL } from "../constants.js";

export interface FalsePositiveReport {
  readonly ruleId: string;
  readonly severity: string;
  readonly category: string;
  readonly message: string;
  readonly relativeFilePath: string;
  readonly line: number;
}

/**
 * Builds a prefilled GitHub "new issue" URL for reporting a false
 * positive, mirroring the CLI's `--explain` follow-up link so reports
 * from the editor and terminal land in the same shape.
 */
export const buildFalsePositiveIssueUrl = (report: FalsePositiveReport): string => {
  const body = [
    "## Diagnostic",
    "",
    `- Rule: ${report.ruleId}`,
    `- Severity: ${report.severity}`,
    `- Category: ${report.category}`,
    `- Location: ${report.relativeFilePath}:${report.line}`,
    "",
    "## Message",
    "",
    "```text",
    report.message,
    "```",
    "",
    "## Why this looks wrong or needs follow-up",
    "",
    "Please explain why this should be changed, suppressed, or treated as a false positive.",
  ].join("\n");

  const url = new URL(`${CANONICAL_GITHUB_URL}/issues/new`);
  url.searchParams.set("title", `Diagnostic follow-up: ${report.ruleId}`);
  url.searchParams.set("labels", "bug");
  url.searchParams.set("body", body);
  return url.toString();
};
