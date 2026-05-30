import { execSync } from "node:child_process";
import os from "node:os";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { groupBy } from "@react-doctor/core";
import { cliLogger as logger } from "./cli-logger.js";
import { formatFixRecipeLine } from "./render-diagnostics.js";
import { prompts } from "./prompts.js";
import { writeDiagnosticsDirectory } from "./write-diagnostics-directory.js";

const MAX_RULES_SHOWN = 10;
const MAX_FILES_PER_RULE = 3;

interface CopyIssuesInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly projectName: string;
}

const buildIssuesSummary = (input: CopyIssuesInput): string => {
  const lines: string[] = [];

  lines.push(`# React Doctor: ${input.projectName}`);
  if (input.score) lines.push(`Score: ${input.score.score}/100`);
  lines.push(`${input.diagnostics.length} issues found`);
  lines.push("");

  const ruleGroups = groupBy(
    [...input.diagnostics],
    (diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`,
  );
  const sortedRules = [...ruleGroups.entries()].sort(
    ([, diagnosticsA], [, diagnosticsB]) => diagnosticsB.length - diagnosticsA.length,
  );

  const visibleRules = sortedRules.slice(0, MAX_RULES_SHOWN);
  for (const [ruleKey, ruleDiagnostics] of visibleRules) {
    const severity = ruleDiagnostics[0].severity;
    const uniqueFiles = [...new Set(ruleDiagnostics.map((diagnostic) => diagnostic.filePath))];
    const shownFiles = uniqueFiles.slice(0, MAX_FILES_PER_RULE);
    const remainingFileCount = uniqueFiles.length - shownFiles.length;

    lines.push(
      `${severity === "error" ? "ERROR" : "WARN"} ${ruleKey} (×${ruleDiagnostics.length})`,
    );
    lines.push(`  ${ruleDiagnostics[0].message}`);
    lines.push(`  ${formatFixRecipeLine(ruleDiagnostics[0])}`);
    for (const filePath of shownFiles) {
      const firstSite = ruleDiagnostics.find(
        (diagnostic) => diagnostic.filePath === filePath && diagnostic.line > 0,
      );
      lines.push(`  - ${filePath}${firstSite ? `:${firstSite.line}` : ""}`);
    }
    if (remainingFileCount > 0) lines.push(`  - +${remainingFileCount} more files`);
  }

  const hiddenRuleCount = sortedRules.length - visibleRules.length;
  if (hiddenRuleCount > 0) {
    lines.push("");
    lines.push(`+${hiddenRuleCount} more rules`);
  }

  try {
    const diagnosticsDirectory = writeDiagnosticsDirectory([...input.diagnostics]);
    lines.push("");
    lines.push(`Full trace: ${diagnosticsDirectory}`);
  } catch {}

  lines.push("");
  lines.push("## How to fix");
  lines.push("1. Run `npx react-doctor@latest --verbose` to see full details");
  lines.push("2. For each rule above, fetch & follow its canonical fix recipe URL before fixing.");
  lines.push("3. Fix errors first, then warnings. Start with high-count rules.");
  lines.push("4. Read the code before acting. Treat findings as hypotheses, not commands.");
  lines.push("5. Fix root causes, not symptoms. Don't suppress rules without evidence.");
  lines.push("6. Run `npx react-doctor@latest --verbose --diff` after changes to verify.");
  lines.push("7. Split unrelated fixes into separate PRs.");

  return lines.join("\n");
};

const copyToClipboard = (text: string): boolean => {
  const platform = os.platform();
  try {
    if (platform === "darwin") {
      execSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    }
    if (platform === "win32") {
      execSync("clip", { input: text, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    }
    execSync("xclip -selection clipboard", { input: text, stdio: ["pipe", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
};

export const promptCopyIssues = async (input: CopyIssuesInput): Promise<void> => {
  if (input.diagnostics.length === 0) return;

  const { shouldCopy } = await prompts(
    {
      type: "confirm",
      name: "shouldCopy",
      message: "Copy issues to clipboard?",
      initial: true,
    },
    { onCancel: () => true },
  );
  if (!shouldCopy) return;

  const issuesSummary = buildIssuesSummary(input);
  if (copyToClipboard(issuesSummary)) {
    logger.log("  Copied to clipboard.");
  } else {
    logger.log(issuesSummary);
  }
};
