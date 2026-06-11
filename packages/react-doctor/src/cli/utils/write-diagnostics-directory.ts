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
  const resolvedDirectory = outputDirectory
    ? path.resolve(outputDirectory)
    : path.join(tmpdir(), `react-doctor-${randomUUID()}`);
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
