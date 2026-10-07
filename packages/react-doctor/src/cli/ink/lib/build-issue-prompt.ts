import { formatFixRecipeLine, formatLearnMoreLine } from "../../utils/diagnostic-grouping.js";
import { TUI_ISSUE_PROMPT_MAX_SITES } from "../../utils/constants.js";
import { formatDiagnosticSite } from "../../utils/format-diagnostic-site.js";
import type { DiagnosticRow } from "./diagnostic-rows.js";

export interface BuildIssuePromptInput {
  readonly row: DiagnosticRow;
  readonly projectName: string;
}

export const buildIssuePrompt = ({ row, projectName }: BuildIssuePromptInput): string => {
  const { representative } = row;
  const severityLabel = row.severity === "error" ? "ERROR" : "WARN";
  const uniqueSites = [...new Set(row.diagnostics.map(formatDiagnosticSite))];
  const inlineSites = uniqueSites.slice(0, TUI_ISSUE_PROMPT_MAX_SITES);
  const remainingSiteCount = uniqueSites.length - inlineSites.length;

  const lines = [
    `Fix exactly one React Doctor rule in ${projectName}:`,
    "",
    `${severityLabel} ${row.category}: ${row.title} (${row.ruleKey}, ×${row.siteCount})`,
    representative.message,
  ];

  if (representative.help) lines.push("", `Suggested fix: ${representative.help}`);

  const fixRecipeLine = formatFixRecipeLine(representative);
  if (fixRecipeLine) lines.push("", fixRecipeLine);

  lines.push(
    "",
    "Scope:",
    `- Fix only ${row.ruleKey}.`,
    "- Fix the root cause; do not suppress, disable, or silence the rule.",
    "- Keep unrelated refactors out of this pass.",
    "",
    "Affected sites:",
    ...inlineSites.map((site) => `- ${site}`),
  );
  if (remainingSiteCount > 0) lines.push(`- +${remainingSiteCount} more sites`);

  const learnMoreLine = formatLearnMoreLine(representative);
  if (learnMoreLine) lines.push("", learnMoreLine);

  lines.push(
    "",
    `Verify with \`npx react-doctor@latest --verbose\` and confirm ${row.ruleKey} is gone before moving on.`,
  );

  return lines.join("\n");
};
