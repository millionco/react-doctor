import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type { Diagnostic } from "@react-doctor/core";
import { buildSortedRuleGroups } from "./diagnostic-grouping.js";
import { formatRuleSummary } from "./render-diagnostics.js";
import * as fs from "node:fs";
import * as path from "node:path";

export const writeDiagnosticsDirectory = (diagnostics: Diagnostic[]): string => {
  const outputDirectory = path.join(tmpdir(), `react-doctor-${randomUUID()}`);
  fs.mkdirSync(outputDirectory, { recursive: true });

  for (const [ruleKey, ruleDiagnostics] of buildSortedRuleGroups(diagnostics)) {
    const fileName = ruleKey.replace(/\//g, "--") + ".txt";
    fs.writeFileSync(path.join(outputDirectory, fileName), formatRuleSummary(ruleKey, ruleDiagnostics));
  }

  fs.writeFileSync(path.join(outputDirectory, "diagnostics.json"), JSON.stringify(diagnostics));

  return outputDirectory;
};
