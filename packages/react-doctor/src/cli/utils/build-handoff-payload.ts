import { TOP_ERRORS_DISPLAY_COUNT } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { HANDOFF_MAX_FILES_PER_RULE } from "./constants.js";
import {
  buildSortedRuleGroups,
  findMigrationScaleBuckets,
  formatFixRecipeLine,
  getSharedFixSiteCount,
} from "./diagnostic-grouping.js";
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
  const migrationScaleBuckets = new Map(
    findMigrationScaleBuckets(input.diagnostics).map((bucket) => [bucket.ruleKey, bucket]),
  );

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
    // A rule group whose sites all share one root-cause fix is ONE task — say
    // "one fix · N sites" so it isn't read as N separate issues to schedule.
    const sharedFixSiteCount = getSharedFixSiteCount(ruleDiagnostics);
    const countBadge =
      sharedFixSiteCount > 0
        ? `one fix · ${sharedFixSiteCount} sites`
        : `×${ruleDiagnostics.length}`;
    lines.push(
      `${index + 1}. ${severityLabel} ${representative.category}: ${representative.title ?? ruleKey} (${countBadge})`,
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
    const migrationBucket = migrationScaleBuckets.get(ruleKey);
    if (migrationBucket) {
      lines.push(
        `   Migration-scale (${migrationBucket.fileCount} files): fix a representative sample, confirm the recipe holds, and get the code owner's sign-off before changing the rest in one pass.`,
      );
    }
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
    "Findings that share a `fixGroupId` (in diagnostics.json) are one root cause — a single fix clears all of them, so treat each `fixGroupId` as ONE task, not one per site.",
    "",
    "Verify against the real thing, don't assume: confirm each change matches the canonical fix recipe you fetched for that rule, then re-run `npx react-doctor@latest --verbose` and check the issue is actually gone against the real tool before moving on.",
    "",
    'Teach me as you go: for every issue you touch, explain it in plain language (no jargon) — what the problem is, why it\'s a problem, and how serious it is in human terms. Describe the real-world impact and severity concretely (e.g. "this crashes the page for users on Safari" vs. "this is a minor cleanup with no user impact") so I understand why it matters, not just what changed.',
    "",
  );

  // Migration-scale rules that fall outside the shown top-N still carry the
  // sample-first warning, so the agent doesn't blindly sweep them when it works
  // through "the rest" — the per-rule note above only reaches the shown groups.
  const shownRuleKeys = new Set(topGroups.map(([ruleKey]) => ruleKey));
  const deferredMigrationBuckets = [...migrationScaleBuckets.values()].filter(
    (bucket) => !shownRuleKeys.has(bucket.ruleKey),
  );
  if (deferredMigrationBuckets.length > 0) {
    const ruleSummaries = deferredMigrationBuckets
      .map((bucket) => `${bucket.title} (${bucket.fileCount} files)`)
      .join(", ");
    lines.push(
      `Some of the rest are migration-scale (span dozens of files): ${ruleSummaries}. For each, fix a representative sample, confirm the recipe holds, and get the code owner's sign-off before changing the rest in one pass.`,
      "",
    );
  }

  lines.push("Then work through the rest from the full results above.");

  return lines.join("\n");
};
