import { CANONICAL_GITHUB_URL } from "../../core/core-product.js";
import type { Diagnostic } from "../../core/core-types.js";

interface BuildDiagnosticIssueUrlInput {
  readonly diagnostic: Diagnostic;
  readonly relativeFilePath: string;
}

const formatRuleIdentifier = (diagnostic: Diagnostic): string =>
  `${diagnostic.plugin}/${diagnostic.rule}`;

const buildDiagnosticIssueBody = (input: BuildDiagnosticIssueUrlInput): string => {
  const { diagnostic, relativeFilePath } = input;
  const ruleIdentifier = formatRuleIdentifier(diagnostic);
  const lines = [
    "## Diagnostic",
    "",
    `- Rule: ${ruleIdentifier}`,
    `- Severity: ${diagnostic.severity}`,
    `- Category: ${diagnostic.category}`,
    `- Location: ${relativeFilePath}:${diagnostic.line}`,
    "",
    "## Message",
    "",
    "```text",
    diagnostic.message,
    "```",
  ];

  if (diagnostic.help) {
    lines.push("", "## Suggested Fix", "", "```text", diagnostic.help, "```");
  }

  lines.push(
    "",
    "## Why this looks wrong or needs follow-up",
    "",
    "Please explain why this should be changed, suppressed, or treated as a false positive.",
  );

  return lines.join("\n");
};

export const buildDiagnosticIssueUrl = (input: BuildDiagnosticIssueUrlInput): string => {
  const { diagnostic, relativeFilePath } = input;
  const issueUrl = new URL(`${CANONICAL_GITHUB_URL}/issues/new`);
  issueUrl.searchParams.set("title", `Diagnostic follow-up: ${formatRuleIdentifier(diagnostic)}`);
  issueUrl.searchParams.set("labels", "bug");
  issueUrl.searchParams.set("body", buildDiagnosticIssueBody({ diagnostic, relativeFilePath }));
  return issueUrl.toString();
};
