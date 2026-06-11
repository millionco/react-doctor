import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type { Diagnostic } from "@react-doctor/core";
import { buildSortedRuleGroups } from "./diagnostic-grouping.js";
import { formatRuleSummary } from "./render-diagnostics.js";
import * as fs from "node:fs";
import * as path from "node:path";

export const writeDiagnosticsDirectory = (
  diagnostics: Diagnostic[],
  outputDirectory?: string | null,
): string => {
  const directory = outputDirectory
    ? path.resolve(outputDirectory)
    : path.join(tmpdir(), `react-doctor-${randomUUID()}`);

  // A user-supplied directory (`--output-dir`) may be reused across runs:
  // clear prior dump artifacts — diagnostics.json and the `plugin--rule.txt`
  // files — and nothing else, so stale rule dumps can't sit next to fresh
  // results.
  if (outputDirectory && fs.existsSync(directory)) {
    for (const fileName of fs.readdirSync(directory)) {
      if (fileName === "diagnostics.json" || /^.+--.+\.txt$/.test(fileName)) {
        fs.rmSync(path.join(directory, fileName), { force: true });
      }
    }
  }
  fs.mkdirSync(directory, { recursive: true });

  for (const [ruleKey, ruleDiagnostics] of buildSortedRuleGroups(diagnostics)) {
    const fileName = ruleKey.replace(/\//g, "--") + ".txt";
    fs.writeFileSync(path.join(directory, fileName), formatRuleSummary(ruleKey, ruleDiagnostics));
  }

  fs.writeFileSync(path.join(directory, "diagnostics.json"), JSON.stringify(diagnostics));

  return directory;
};
