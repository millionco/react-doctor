import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Diagnostic } from "@react-doctor/core";
import { buildSortedRuleGroups } from "./diagnostic-grouping.js";
import { formatRuleSummary } from "./render-diagnostics.js";

export const writeDiagnosticsDirectory = (diagnostics: Diagnostic[]): string => {
  const outputDirectory = join(tmpdir(), `react-doctor-${randomUUID()}`);
  mkdirSync(outputDirectory, { recursive: true });

  for (const [ruleKey, ruleDiagnostics] of buildSortedRuleGroups(diagnostics)) {
    const fileName = ruleKey.replace(/\//g, "--") + ".txt";
    writeFileSync(join(outputDirectory, fileName), formatRuleSummary(ruleKey, ruleDiagnostics));
  }

  writeFileSync(join(outputDirectory, "diagnostics.json"), JSON.stringify(diagnostics));

  return outputDirectory;
};
