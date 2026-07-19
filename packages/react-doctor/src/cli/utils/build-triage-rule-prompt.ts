import * as path from "node:path";
import type { Diagnostic } from "@react-doctor/core";
import { TRIAGE_PROMPT_MAX_INLINE_SITES } from "./constants.js";
import { formatFixRecipeLine } from "./diagnostic-grouping.js";
import { ruleDumpFileName } from "./write-diagnostics-directory.js";

export interface BuildTriageRulePromptInput {
  readonly ruleKey: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly projectName: string;
  readonly outputDirectory: string;
}

const formatLocation = (diagnostic: Diagnostic): string => {
  if (diagnostic.line > 0) {
    return `${diagnostic.filePath}:${diagnostic.line}`;
  }
  return diagnostic.filePath;
};

const formatCommandArgument = (value: string): string => JSON.stringify(value);

export const buildTriageRulePrompt = (input: BuildTriageRulePromptInput): string => {
  const representative = input.diagnostics[0];
  if (representative === undefined) {
    return `No diagnostics found for ${input.ruleKey}.`;
  }

  const severityLabel = representative.severity === "error" ? "ERROR" : "WARN";
  const title = representative.title ?? input.ruleKey;
  const ruleDumpPath = path.join(input.outputDirectory, ruleDumpFileName(input.ruleKey));
  const uniqueLocations = [...new Set(input.diagnostics.map(formatLocation))];
  const inlineLocations = uniqueLocations.slice(0, TRIAGE_PROMPT_MAX_INLINE_SITES);
  const remainingLocationCount = uniqueLocations.length - inlineLocations.length;
  const fixRecipeLine = formatFixRecipeLine(representative);
  const lines = [
    `Fix exactly one React Doctor rule in ${input.projectName}:`,
    "",
    `${severityLabel} ${representative.category}: ${title} (${input.ruleKey}, x${input.diagnostics.length})`,
    representative.message,
  ];

  if (representative.help) {
    lines.push("", `Suggested fix: ${representative.help}`);
  }
  if (fixRecipeLine) {
    lines.push("", fixRecipeLine);
  }

  lines.push(
    "",
    "Scope:",
    `- Fix only ${input.ruleKey}.`,
    "- Fix the root cause; do not suppress, disable, or silence the rule.",
    "- Keep unrelated refactors out of this pass.",
    "",
    "Affected sites:",
  );

  for (const location of inlineLocations) {
    lines.push(`- ${location}`);
  }
  if (remainingLocationCount > 0) {
    lines.push(`- +${remainingLocationCount} more sites in ${ruleDumpPath}`);
  }

  lines.push(
    "",
    `Full per-rule diagnostics: ${ruleDumpPath}`,
    "",
    "Verification:",
    `- Re-run \`react-doctor triage --output-dir ${formatCommandArgument(input.outputDirectory)}\` after editing.`,
    `- Confirm ${input.ruleKey} is gone before moving to the next rule.`,
  );

  return lines.join("\n");
};
