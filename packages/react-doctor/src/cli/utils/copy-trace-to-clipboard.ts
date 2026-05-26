import { execSync } from "node:child_process";
import os from "node:os";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { groupBy } from "@react-doctor/core";
import { prompts } from "./prompts.js";

interface CopyTraceInput {
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly score: ScoreResult | null;
  readonly directory: string;
  readonly projectName: string;
}

const buildTraceSummary = (input: CopyTraceInput): string => {
  const lines: string[] = [];

  lines.push(`React Doctor — ${input.projectName}`);
  if (input.score) {
    lines.push(`Score: ${input.score.score} / 1000 (${input.score.label})`);
  }
  lines.push(`Issues: ${input.diagnostics.length}`);
  lines.push("");

  const categoryGroups = groupBy([...input.diagnostics], (diagnostic) => diagnostic.category);
  for (const [category, categoryDiagnostics] of categoryGroups) {
    const errorCount = categoryDiagnostics.filter(
      (diagnostic) => diagnostic.severity === "error",
    ).length;
    const warningCount = categoryDiagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning",
    ).length;
    const parts: string[] = [];
    if (errorCount > 0) parts.push(`${errorCount} errors`);
    if (warningCount > 0) parts.push(`${warningCount} warnings`);
    lines.push(`  ${category}: ${parts.join(", ")}`);
  }

  lines.push("");
  lines.push("Run with details:");
  lines.push(`  npx react-doctor@latest ${input.directory} --verbose`);

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
