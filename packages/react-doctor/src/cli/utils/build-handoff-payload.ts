import { TOP_ERRORS_DISPLAY_COUNT } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { HANDOFF_MAX_FILES_PER_RULE } from "./constants.js";
import { buildSortedRuleGroups, formatFixRecipeLine } from "./diagnostic-grouping.js";
import { writeDiagnosticsDirectory } from "./write-diagnostics-directory.js";

export interface HandoffPayloadInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly projectName: string;
  readonly outputDirectory?: string | null;
}

// A focused prompt for the chosen agent: solve the TOP-N issues this pass,
// with the full set of findings written to disk (diagnostics.json + a .txt
// per rule) for follow-up. Keeps the first pass small & high-signal rather
// than dumping every issue inline.
export const buildHandoffPayload = (input: HandoffPayloadInput): string => {
  const topGroups = buildSortedRuleGroups(input.diagnostics).slice(0, TOP_ERRORS_DISPLAY_COUNT);

  let outputDirectory: string | null = null;
  try {
    outputDirectory = writeDiagnosticsDirectory([...input.diagnostics], input.outputDirectory);
  } catch {}

  const lines: string[] = [
    `Fix the top ${topGroups.length} React Doctor ${topGroups.length === 1 ? "issue" : "issues"} in ${input.projectName} on this pass — leave the rest for a follow-up.`,
    "",
  ];

  topGroups.forEach(([ruleKey, ruleDiagnostics], index) => {
    const representative = ruleDiagnostics[0]!;
    const severityLabel = representative.severity === "error" ? "ERROR" : "WARN";
    lines.push(
      `${index + 1}. ${severityLabel} ${representative.category}: ${representative.title ?? ruleKey} (×${ruleDiagnostics.length})`,
      `   ${representative.message}`,
    );
    const fixRecipeLine = formatFixRecipeLine(representative);
    if (fixRecipeLine) lines.push(`   ${fixRecipeLine}`);
    const uniqueFiles = [...new Set(ruleDiagnostics.map((diagnostic) => diagnostic.filePath))];
    for (const filePath of uniqueFiles.slice(0, HANDOFF_MAX_FILES_PER_RULE)) {
      const firstSite = ruleDiagnostics.find(
        (diagnostic) => diagnostic.filePath === filePath && diagnostic.line > 0,
      );
      lines.push(`   - ${filePath}${firstSite ? `:${firstSite.line}` : ""}`);
    }
    const remainingFiles = uniqueFiles.length - HANDOFF_MAX_FILES_PER_RULE;
    if (remainingFiles > 0) lines.push(`   - +${remainingFiles} more files`);
  });

  lines.push("");
  if (outputDirectory) {
    lines.push(
      `Full results for all ${input.diagnostics.length} issues (diagnostics.json + a .txt per rule): ${outputDirectory}`,
      "",
    );
  }
  lines.push(
    "Read each file and fix the root cause — don't suppress or silence the rule.",
    "",
    "Verify against the real thing, don't assume: confirm each change matches the canonical fix recipe you fetched for that rule, then re-run `npx react-doctor@latest --verbose` and check the issue is actually gone against the real tool before moving on.",
    "",
    'Teach me as you go: for every issue you touch, explain it in plain language (no jargon) — what the problem is, why it\'s a problem, and how serious it is in human terms. Describe the real-world impact and severity concretely (e.g. "this crashes the page for users on Safari" vs. "this is a minor cleanup with no user impact") so I understand why it matters, not just what changed.',
    "",
    "Then work through the rest from the full results above.",
  );

  return lines.join("\n");
};
