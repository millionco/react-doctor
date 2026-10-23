import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { noDerivedState } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-derived-state.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";
import { MODULE_SCOPE_SNIPPET_POOL } from "../src/snippet-pools.js";

const corpusDirectory = new URL("../corpus/regressions/", import.meta.url);
const consumerName = "no-derived-state--radix-pending-draft.tsx.txt";
const mirrorName = "no-derived-state--bare-pending-copy.tsx.txt";
const consumerPath = fileURLToPath(new URL(consumerName, corpusDirectory));
const filename = consumerPath.replace(/\.txt$/, "");
const code = readFileSync(consumerPath, "utf8");

describe("supported default Radix pending selection", () => {
  it("preserves user input while retaining a bare copied-state warning", () => {
    const result = runRule(noDerivedState, code, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    const mirrorPath = fileURLToPath(new URL(mirrorName, corpusDirectory));
    const mirror = runRule(noDerivedState, readFileSync(mirrorPath, "utf8"), {
      filename: mirrorPath.replace(/\.txt$/, ""),
    });
    expect(mirror.parseErrors).toEqual([]);
    expect(mirror.diagnostics).toHaveLength(1);
  });
  it("checks both honest corpus verdicts and target fire coverage", () => {
    const corpus = loadFuzzCorpus(fileURLToPath(corpusDirectory), {
      maximumFiles: Number.POSITIVE_INFINITY,
    })
      .filter((entry) => entry.relativePath === consumerName || entry.relativePath === mirrorName)
      .map((entry) => ({
        ...entry,
        sourcePath: fileURLToPath(new URL(entry.relativePath, corpusDirectory)).replace(
          /\.txt$/,
          "",
        ),
      }));
    expect(corpus).toHaveLength(2);
    const result = fuzzRuleWithStats("no-derived-state", noDerivedState, { iterations: 0, corpus });
    expect(result.findings).toEqual([]);
    expect(result.stats.executedProgramCount).toBe(2);
    expect(result.stats.skippedParseErrorCount).toBe(0);
    expect(result.stats.firedProgramCount).toBe(1);
  });
  it("includes both paired source shapes in the module generator", () => {
    const entries = MODULE_SCOPE_SNIPPET_POOL.filter(
      (entry) =>
        entry.includes("export const FuzzDraftChoices =") ||
        entry.includes("export const FuzzCopiedChoices ="),
    );
    expect(entries).toHaveLength(2);
    const counts = entries.map((entry) => {
      const result = runRule(
        noDerivedState,
        'import { useEffect, useState } from "react";\n' + entry,
        { filename },
      );
      expect(result.parseErrors).toEqual([]);
      return result.diagnostics.length;
    });
    expect(counts).toEqual([0, 1]);
  });
});
