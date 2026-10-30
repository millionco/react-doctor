import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { exhaustiveDeps } from "../../oxlint-plugin-react-doctor/src/plugin/rules/react-builtins/exhaustive-deps.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import type { FuzzCorpusEntry } from "../src/load-fuzz-corpus.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";
import { DEFAULT_FUZZ_ITERATIONS, DEFAULT_FUZZ_SEED } from "../src/constants.js";

const corpus = loadFuzzCorpus(
  fileURLToPath(new URL("../corpus/direct-member-alias", import.meta.url)),
);
const settings = { "react-doctor": { portedRuleMode: "curated" } };

describe("readonly member alias declared verdicts", () => {
  it("loads both active verdicts and detects their inversion", () => {
    expect(corpus.map((entry) => entry.verdict).sort()).toEqual(["fail", "pass"]);
    for (const entry of corpus) {
      expect(entry.ruleIds).toEqual([exhaustiveDeps.id]);
      const result = runRule(exhaustiveDeps, entry.code, { settings });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(entry.verdict === "pass" ? 0 : 1);
    }
    const inverted = corpus.map(
      (entry): FuzzCorpusEntry => ({
        ...entry,
        verdict: entry.verdict === "pass" ? "fail" : "pass",
      }),
    );
    const result = fuzzRuleWithStats(exhaustiveDeps.id, exhaustiveDeps, {
      iterations: 0,
      corpus: inverted,
      settings,
    });
    expect(result.findings.map((finding) => finding.kind)).toEqual([
      "verdict-mismatch",
      "verdict-mismatch",
    ]);
  });

  it("keeps both verdicts while exercising the reporting path", () => {
    const result = fuzzRuleWithStats(exhaustiveDeps.id, exhaustiveDeps, {
      iterations: DEFAULT_FUZZ_ITERATIONS,
      seed: DEFAULT_FUZZ_SEED,
      checkInvariants: true,
      corpus,
      settings,
    });
    expect(result.findings).toEqual([]);
    expect(result.stats.firedProgramCount).toBeGreaterThan(0);
  });
});
