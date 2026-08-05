import type { Diagnostic } from "@react-doctor/core";
import { formatFixRecipeLine } from "./diagnostic-grouping.js";
import { formatDiagnosticSite } from "./format-diagnostic-site.js";

const formatFileContextTag = (diagnostic: Diagnostic): string =>
  diagnostic.fileContext ? ` (${diagnostic.fileContext} file)` : "";

export const formatRuleSummary = (
  ruleKey: string,
  ruleDiagnostics: ReadonlyArray<Diagnostic>,
): string => {
  const firstDiagnostic = ruleDiagnostics[0];
  if (firstDiagnostic === undefined) return "";

  const distinctMessages = [...new Set(ruleDiagnostics.map((diagnostic) => diagnostic.message))];
  const sections = [
    `Rule: ${ruleKey}`,
    `Severity: ${firstDiagnostic.severity}`,
    `Category: ${firstDiagnostic.category}`,
    `Count: ${ruleDiagnostics.length}`,
    "",
    distinctMessages.join("\n\n"),
  ];

  if (firstDiagnostic.help) sections.push("", `Suggestion: ${firstDiagnostic.help}`);
  if (firstDiagnostic.url) sections.push("", `Docs: ${firstDiagnostic.url}`);
  const fixRecipeLine = formatFixRecipeLine(firstDiagnostic);
  if (fixRecipeLine) sections.push("", fixRecipeLine);

  sections.push("", "Files:");
  for (const diagnostic of ruleDiagnostics) {
    sections.push(`  ${formatDiagnosticSite(diagnostic)}${formatFileContextTag(diagnostic)}`);
    if (diagnostic.suppressionHint) sections.push(`    ${diagnostic.suppressionHint}`);
  }

  return `${sections.join("\n")}\n`;
};
