import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type { Diagnostic } from "@react-doctor/core";
import { buildSortedRuleGroups } from "./diagnostic-grouping.js";
import { formatRuleSummary } from "./render-diagnostics.js";
import * as fs from "node:fs";
import * as path from "node:path";

const ruleDumpFileName = (ruleKey: string): string => ruleKey.replace(/\//g, "--") + ".txt";

// Derives the rule dump files a previous run wrote into this directory from
// the diagnostics.json it left behind. An absent, unreadable, or foreign
// file yields nothing — better to leave a stale dump than delete a file the
// tool never wrote.
const readPreviousRuleDumpFileNames = (directory: string): ReadonlySet<string> => {
  try {
    const previous: Diagnostic[] = JSON.parse(
      fs.readFileSync(path.join(directory, "diagnostics.json"), "utf8"),
    );
    return new Set(
      previous
        .filter((d) => typeof d?.plugin === "string" && typeof d?.rule === "string")
        .map((d) => ruleDumpFileName(`${d.plugin}/${d.rule}`)),
    );
  } catch {
    return new Set();
  }
};

export const writeDiagnosticsDirectory = (
  diagnostics: Diagnostic[],
  outputDirectory?: string | null,
): string => {
  const directory = outputDirectory
    ? path.resolve(outputDirectory)
    : path.join(tmpdir(), `react-doctor-${randomUUID()}`);

  // A user-supplied directory (`--output-dir`) may be reused across runs.
  // The previous run's diagnostics.json records exactly which rule files
  // were written, so cleanup removes those and only those — user files are
  // never matched by name shape.
  if (outputDirectory) {
    for (const fileName of readPreviousRuleDumpFileNames(directory)) {
      fs.rmSync(path.join(directory, fileName), { force: true });
    }
  }
  fs.mkdirSync(directory, { recursive: true });

  for (const [ruleKey, ruleDiagnostics] of buildSortedRuleGroups(diagnostics)) {
    fs.writeFileSync(
      path.join(directory, ruleDumpFileName(ruleKey)),
      formatRuleSummary(ruleKey, ruleDiagnostics),
    );
  }

  fs.writeFileSync(path.join(directory, "diagnostics.json"), JSON.stringify(diagnostics));

  return directory;
};
