import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { fuzzRule } from "../src/fuzz-rule.js";
import { generateStructuredFuzzProgram } from "../src/generate-fuzz-program.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";
import { createSeededRandom } from "../src/seeded-random.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import type { Rule } from "../../oxlint-plugin-react-doctor/src/plugin/utils/rule.js";

const NOOP_RULE: Rule = { id: "fuzz-smoke-noop", severity: "warn", create: () => ({}) };

describe("fuzz harness oracles", () => {
  // Generator health: every unmutated program must parse — a snippet-pool
  // typo would otherwise silently turn iterations into parse-error skips.
  it("generates programs that all parse cleanly", () => {
    const unparseableSeeds: number[] = [];
    for (let seedValue = 1; seedValue <= 100; seedValue += 1) {
      const { code } = generateStructuredFuzzProgram(createSeededRandom(seedValue));
      const result = runRule(NOOP_RULE, code);
      if (result.parseErrors.length > 0) unparseableSeeds.push(seedValue);
    }
    expect(unparseableSeeds).toEqual([]);
  });

  it("joins multi-section programs back into the exact generated code", () => {
    let checkedCount = 0;
    for (let seedValue = 1; seedValue <= 20; seedValue += 1) {
      const { code, sections } = generateStructuredFuzzProgram(createSeededRandom(seedValue));
      if (sections.length < 2) continue;
      expect(`${sections.join("\n\n")}\n`).toBe(code);
      checkedCount += 1;
    }
    expect(checkedCount).toBeGreaterThan(0);
  });

  // The regression corpus holds confirmed false positives — valid programs
  // by definition, so every seed must parse (a broken seed would silently
  // stop exercising its weakness class).
  it("loads a regression corpus whose every seed parses cleanly", () => {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const corpus = loadFuzzCorpus(path.join(packageRoot, "corpus"));
    expect(corpus.length).toBeGreaterThan(0);
    const unparseable = corpus.filter(
      (entry) =>
        runRule(NOOP_RULE, entry.code, { filename: entry.relativePath, forceJsx: true }).parseErrors
          .length > 0,
    );
    expect(unparseable.map((entry) => entry.relativePath)).toEqual([]);
  });

  it("catches a rule that crashes on JSX", () => {
    const crashingRule: Rule = {
      id: "fuzz-smoke-crash",
      severity: "warn",
      create: () => ({
        JSXOpeningElement: () => {
          throw new Error("boom");
        },
      }),
    };
    const findings = fuzzRule("fuzz-smoke-crash", crashingRule, { iterations: 10, seed: 1 });
    expect(findings.some((finding) => finding.kind === "crash")).toBe(true);
  });

  it("catches a rule that keys off incidental source shape", () => {
    const commentSensitiveRule: Rule = {
      id: "fuzz-smoke-invariant",
      severity: "warn",
      create: (context) => ({
        Program: (node) => {
          context.report({ message: `range ${JSON.stringify(node.range)}`, node });
        },
      }),
    };
    const findings = fuzzRule("fuzz-smoke-invariant", commentSensitiveRule, {
      iterations: 10,
      seed: 1,
      checkInvariants: true,
    });
    expect(findings.some((finding) => finding.kind === "invariant-violation")).toBe(true);
  });
});
