import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { exhaustiveDeps } from "../../oxlint-plugin-react-doctor/src/plugin/rules/react-builtins/exhaustive-deps.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { DEFAULT_FUZZ_ITERATIONS, DEFAULT_FUZZ_SEED } from "../src/constants.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";
import type { FuzzCorpusEntry } from "../src/load-fuzz-corpus.js";

it("fuzzes configured forwarding with loaded pass and fail verdicts", () => {
  const corpus = loadFuzzCorpus(
    fileURLToPath(new URL("./fixtures/configured-hook-forwarding", import.meta.url)),
  );
  expect(corpus.map((entry) => [entry.relativePath, entry.ruleIds, entry.verdict])).toEqual([
    ["complete.tsx.txt", ["exhaustive-deps"], "pass"],
    ["missing.tsx.txt", ["exhaustive-deps"], "fail"],
  ]);
  const settings = {
    "react-doctor": {
      portedRuleMode: "curated",
      exhaustiveDeps: { additionalHooks: "^useScopedEffect$" },
    },
  };
  for (const entry of corpus) {
    const result = runRule(exhaustiveDeps, entry.code, { settings });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      entry.verdict === "pass"
        ? []
        : ["`useScopedEffect` can run with a stale `token` & show your users old data."],
    );
    expect(runRule(exhaustiveDeps, entry.code).diagnostics.length).toBeGreaterThan(0);
  }
  const iterations = Number(process.env.FUZZ_ITERATIONS ?? DEFAULT_FUZZ_ITERATIONS);
  const seed = Number(process.env.FUZZ_SEED ?? DEFAULT_FUZZ_SEED);
  expect(Number.isInteger(iterations) && iterations > 0).toBe(true);
  expect(Number.isInteger(seed) && seed > 0).toBe(true);
  const invertedCorpus: FuzzCorpusEntry[] = corpus.map((entry) => ({
    ...entry,
    verdict: entry.verdict === "pass" ? "fail" : "pass",
  }));
  const inverted = fuzzRuleWithStats("exhaustive-deps", exhaustiveDeps, {
    corpus: invertedCorpus,
    settings,
    iterations: DEFAULT_FUZZ_ITERATIONS,
    seed,
  });
  expect(inverted.findings.map((finding) => finding.kind)).toEqual(
    corpus.map(() => "verdict-mismatch"),
  );
  const mismatchedRuleIds = fuzzRuleWithStats("exhaustive-deps", exhaustiveDeps, {
    corpus: invertedCorpus.map((entry) => ({ ...entry, ruleIds: ["unrelated-rule"] })),
    settings,
    iterations: DEFAULT_FUZZ_ITERATIONS,
    seed,
  });
  expect(mismatchedRuleIds.findings).toEqual([]);
  const result = fuzzRuleWithStats("exhaustive-deps", exhaustiveDeps, {
    corpus,
    settings,
    iterations,
    seed,
    checkInvariants: true,
  });
  process.stdout.write(
    `CONFIGURED_FORWARDING_FUZZ ${JSON.stringify({ iterations, seed, portedRuleMode: settings["react-doctor"].portedRuleMode, declaredOracles: corpus.length, invertedVerdictMismatches: inverted.findings.length, mismatchedRuleIdFindings: mismatchedRuleIds.findings.length, ...result })}\n`,
  );
  expect(result.stats.executedProgramCount).toBeGreaterThan(0);
  expect(result.stats.firedProgramCount).toBeGreaterThan(0);
  expect(result.findings).toEqual([]);
});
