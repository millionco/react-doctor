import { CANONICAL_GITHUB_URL } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { anonymizeText } from "./anonymize-text.js";

interface BuildDiagnosticIssueUrlInput {
  readonly diagnostic: Diagnostic;
  readonly relativeFilePath: string;
}

const formatRuleIdentifier = (diagnostic: Diagnostic): string =>
  `${diagnostic.plugin}/${diagnostic.rule}`;

const buildDiagnosticIssueBody = (input: BuildDiagnosticIssueUrlInput): string => {
  const { diagnostic, relativeFilePath } = input;
  const ruleIdentifier = formatRuleIdentifier(diagnostic);
  const location = anonymizeText(relativeFilePath);
  const message = anonymizeText(diagnostic.message);
  const lines = [
    "## Diagnostic",
    "",
    `- Rule: ${ruleIdentifier}`,
    `- Severity: ${diagnostic.severity}`,
    `- Category: ${diagnostic.category}`,
    `- Location: ${location}:${diagnostic.line}`,
    "",
    "## Message",
    "",
    "```text",
    message,
    "```",
  ];

  if (diagnostic.help) {
    lines.push("", "## Suggested Fix", "", "```text", anonymizeText(diagnostic.help), "```");
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
