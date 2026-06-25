import { describe, expect, it } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runRule } from "../src/test-utils/run-rule.js";
import { ruleRegistry } from "../src/plugin/rule-registry.js";
import type { Rule } from "../src/plugin/utils/rule.js";

// Adversarial control-flow corpus for the CFG/SSA/typestate-backed rules. Each
// snippet stresses a tricky control-flow shape — early returns, throw edges,
// try/finally, do-while / labeled / infinite loops, switch fallthrough,
// short-circuits, callbacks escaping loops, multi-write shadowing — the exact
// surface the shared CFG analysis layer reasons over.
//
// These are CHARACTERIZATION tests: `expectedToFlag` records the engine's
// CURRENT, hand-verified behavior, so any later change to the shared
// CFG/SSA/dataflow analysis that silently flips one of these shapes fails here
// for review. Every expectation was reconciled against the rule's documented
// intent; the two `knownGap` entries pin current behavior where it is a tracked
// bug (flip the expectation when the bug is fixed).

interface CorpusEntry {
  rule: string;
  name: string;
  code: string;
  expectedToFlag: boolean;
  knownGap?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const corpus = JSON.parse(
  readFileSync(join(here, "fixtures/cfg-adversarial-corpus.json"), "utf8"),
) as CorpusEntry[];

const corpusByRule = new Map<string, CorpusEntry[]>();
for (const entry of corpus) {
  const entries = corpusByRule.get(entry.rule) ?? [];
  entries.push(entry);
  corpusByRule.set(entry.rule, entries);
}

describe("CFG-backed rules — adversarial control-flow corpus", () => {
  for (const [ruleId, entries] of corpusByRule) {
    describe(ruleId, () => {
      for (const entry of entries) {
        const label = entry.knownGap ? `${entry.name} [known gap: ${entry.knownGap}]` : entry.name;
        it(label, () => {
          const rule = (ruleRegistry as Record<string, Rule>)[ruleId];
          expect(rule).toBeDefined();
          const result = runRule(rule, entry.code, {
            filename: `${entry.name}.tsx`,
            forceJsx: true,
          });
          expect(result.parseErrors).toEqual([]);
          expect(result.diagnostics.length > 0).toBe(entry.expectedToFlag);
        });
      }
    });
  }

  it("covers all eight CFG/SSA/typestate-consuming rules", () => {
    expect(corpusByRule.size).toBe(8);
    expect(corpus.length).toBeGreaterThanOrEqual(180);
  });
});
