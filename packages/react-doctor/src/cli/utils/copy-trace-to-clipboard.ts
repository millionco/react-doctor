import { execSync } from "node:child_process";
import os from "node:os";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { groupBy } from "@react-doctor/core";
import { prompts } from "./prompts.js";

const MAX_RULES_SHOWN = 10;
const MAX_FILES_PER_RULE = 3;

interface CopyTraceInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly directory: string;
  readonly projectName: string;
}

const buildTraceSummary = (input: CopyTraceInput): string => {
  const lines: string[] = [];

  lines.push(`# React Doctor: ${input.projectName}`);
  if (input.score) lines.push(`Score: ${input.score.score}/1000`);
  lines.push(`${input.diagnostics.length} issues found`);
  lines.push("");

  const ruleGroups = groupBy([...input.diagnostics], (diagnostic) => diagnostic.rule);
  const sortedRules = [...ruleGroups.entries()].sort(
    ([, diagnosticsA], [, diagnosticsB]) => diagnosticsB.length - diagnosticsA.length,
  );

  const visibleRules = sortedRules.slice(0, MAX_RULES_SHOWN);
  for (const [rule, ruleDiagnostics] of visibleRules) {
    const severity = ruleDiagnostics[0].severity;
    const uniqueFiles = [...new Set(ruleDiagnostics.map((diagnostic) => diagnostic.filePath))];
    const shownFiles = uniqueFiles.slice(0, MAX_FILES_PER_RULE);
    const remainingFileCount = uniqueFiles.length - shownFiles.length;

    lines.push(`${severity === "error" ? "ERROR" : "WARN"} ${rule} (×${ruleDiagnostics.length})`);
    lines.push(`  ${ruleDiagnostics[0].message}`);
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

  lines.push("");
  lines.push("To fix: npx react-doctor@latest --verbose");

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

export const promptCopyTrace = async (input: CopyTraceInput): Promise<void> => {
  if (input.diagnostics.length === 0) return;

  const { shouldCopy } = await prompts(
    {
      type: "confirm",
      name: "shouldCopy",
      message: "Copy trace to clipboard?",
      initial: true,
    },
    { onCancel: () => true },
  );
  if (!shouldCopy) return;

  const trace = buildTraceSummary(input);
  if (copyToClipboard(trace)) {
    console.log("  Copied to clipboard.");
  } else {
    console.log(trace);
  }
};
