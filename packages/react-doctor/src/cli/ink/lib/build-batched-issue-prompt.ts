import { formatFixRecipeLine, formatLearnMoreLine } from "../../utils/diagnostic-grouping.js";
import { TUI_ISSUE_PROMPT_MAX_SITES } from "../../utils/constants.js";
import { formatDiagnosticSite } from "../../utils/format-diagnostic-site.js";
import type { DiagnosticRow } from "./diagnostic-rows.js";

export interface BuildBatchedIssuePromptInput {
  readonly rows: ReadonlyArray<DiagnosticRow>;
  readonly projectName: string;
}

export const buildBatchedIssuePrompt = ({ rows, projectName }: BuildBatchedIssuePromptInput): string => {
  if (rows.length === 0) return "";
  
  const lines = [
    `Fix ${rows.length} React Doctor ${rows.length === 1 ? "finding" : "findings"} in ${projectName}:`,
    "",
  ];

  rows.forEach((row, index) => {
    const { representative } = row;
    const severityLabel = row.severity === "error" ? "ERROR" : "WARN";
    const uniqueSites = [...new Set(row.diagnostics.map(formatDiagnosticSite))];
    const inlineSites = uniqueSites.slice(0, TUI_ISSUE_PROMPT_MAX_SITES);
    const remainingSiteCount = uniqueSites.length - inlineSites.length;

    lines.push(
      `${index + 1}. ${severityLabel} ${row.category}: ${row.title} (${row.ruleKey}, ×${row.siteCount})`,
      `   ${representative.message}`,
    );

    if (representative.help) lines.push(`   Suggested fix: ${representative.help}`);

    const fixRecipeLine = formatFixRecipeLine(representative);
    if (fixRecipeLine) lines.push(`   ${fixRecipeLine}`);

    lines.push(`   Affected sites:`);
    for (const site of inlineSites) {
      lines.push(`   - ${site}`);
    }
    if (remainingSiteCount > 0) lines.push(`   - +${remainingSiteCount} more sites`);

    const learnMoreLine = formatLearnMoreLine(representative);
    if (learnMoreLine) lines.push(`   ${learnMoreLine}`);

    lines.push("");
  });

  const ruleKeys = rows.map((row) => row.ruleKey).join(", ");
  
  lines.push(
    "Scope:",
    `- Fix only these rules: ${ruleKeys}`,
    "- Fix the root cause for each; do not suppress, disable, or silence the rules.",
    "- Keep unrelated refactors out of this pass.",
    "",
    `Verify with \`npx react-doctor@latest --verbose\` and confirm all issues are resolved before moving on.`,
  );

  return lines.join("\n");
};
