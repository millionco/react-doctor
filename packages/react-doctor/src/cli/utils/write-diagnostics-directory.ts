import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type { Diagnostic } from "@react-doctor/core";
import { buildSortedRuleGroups } from "./diagnostic-grouping.js";
import { formatRuleSummary } from "./render-diagnostics.js";
import * as fs from "node:fs";
import * as path from "node:path";

// Rule keys are always `plugin/rule`, so dump files always contain `--`
// (the slash replacement below) — matching that shape keeps the cleanup
// from touching unrelated files in a user-supplied directory.
const ruleDumpFilePattern = /^[^/\\]+--[^/\\]+\.txt$/;

const removeStaleDumpFiles = (directory: string): void => {
  if (!fs.existsSync(directory)) return;
  for (const fileName of fs.readdirSync(directory)) {
    if (fileName === "diagnostics.json" || ruleDumpFilePattern.test(fileName)) {
      fs.rmSync(path.join(directory, fileName), { force: true });
    }
  }
};

export const writeDiagnosticsDirectory = (
  diagnostics: Diagnostic[],
  outputDirectory?: string | null,
): string => {
  const resolvedDirectory = outputDirectory
    ? path.resolve(outputDirectory)
    : path.join(tmpdir(), `react-doctor-${randomUUID()}`);
  if (outputDirectory) {
    removeStaleDumpFiles(resolvedDirectory);
  }
  fs.mkdirSync(resolvedDirectory, { recursive: true });

  for (const [ruleKey, ruleDiagnostics] of buildSortedRuleGroups(diagnostics)) {
    const fileName = ruleKey.replace(/\//g, "--") + ".txt";
    fs.writeFileSync(
      path.join(resolvedDirectory, fileName),
      formatRuleSummary(ruleKey, ruleDiagnostics),
    );
  }

  fs.writeFileSync(path.join(resolvedDirectory, "diagnostics.json"), JSON.stringify(diagnostics));

  return resolvedDirectory;
};
