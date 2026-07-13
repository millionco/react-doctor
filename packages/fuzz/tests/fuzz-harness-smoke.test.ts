import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { fuzzRule } from "../src/fuzz-rule.js";
import { generateStructuredFuzzProgram } from "../src/generate-fuzz-program.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";
import { createSeededRandom } from "../src/seeded-random.js";
import { buildAstEquivalentFuzzVariants } from "../src/ast-equivalent-fuzz-variants.js";
import { buildVerdictPreservingVariants } from "../src/verdict-preserving-variants.js";
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

  // The corpus holds confirmed false positives (regressions/) and confirmed
  // true positives (true-positives/) — every seed must parse (a broken seed
  // would silently stop exercising its weakness class). Firing expectations
  // live in each rule's unit suite, never here.
  it("loads a corpus whose every seed parses cleanly", () => {
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

  // Every verdict-preserving rewrite must itself parse — a variant that
  // breaks the program would be filtered and silently stop applying
  // mutation pressure. Checked over generated programs (JSX, hooks,
  // module-scope sections) rather than one hand-written sample.
  it("builds verdict-preserving variants that all parse cleanly", () => {
    let variantCount = 0;
    const labels = new Set<string>();
    for (let seedValue = 1; seedValue <= 50; seedValue += 1) {
      const { code } = generateStructuredFuzzProgram(createSeededRandom(seedValue));
      for (const variant of buildVerdictPreservingVariants(code, "fixture.tsx")) {
        variantCount += 1;
        labels.add(variant.label);
        const result = runRule(NOOP_RULE, variant.code, { forceJsx: true });
        expect(
          result.parseErrors,
          `variant "${variant.label}" broke the program:\n${variant.code}`,
        ).toEqual([]);
      }
    }
    expect(variantCount).toBeGreaterThan(0);
    expect(labels).toContain("parenthesized call receivers");
    expect(labels).toContain("concise arrow bodies converted to block returns");
    expect(labels).toContain("no-op prologue statement in every function body");
  });

  it("rewrites member calls into computed spelling in the advisory tier", () => {
    const variants = buildVerdictPreservingVariants(
      `export const App = () => { document.write("x"); return null; };`,
      "fixture.tsx",
    );
    const computed = variants.find(
      (variant) => variant.label === "computed-member call properties",
    );
    expect(computed?.code).toContain(`document["write"]("x")`);
    expect(computed?.mustPreserveVerdict).toBe(false);
    const castReceiver = variants.find((variant) => variant.label === "as-any call receivers");
    expect(castReceiver?.code).toContain(`(document as any).write("x")`);
    expect(castReceiver?.mustPreserveVerdict).toBe(true);
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

  it("extracts inline effect callbacks to exact const bindings", () => {
    const variants = buildAstEquivalentFuzzVariants(
      `const Widget = ({ url }) => {
  useEffect(() => fetch(url), [url]);
  React.useLayoutEffect(function measure() { readLayout(); }, []);
  useInsertionEffect((() => track()) as () => void, []);
  return null;
};`,
      "fixture.tsx",
      true,
    );
    const aliasVariant = variants.find(
      (variant) => variant.label === "inline effect callbacks extracted to const bindings",
    );
    expect(aliasVariant?.code).toContain(
      "const __reactDoctorFuzzEffectCallback0 = () => fetch(url);",
    );
    expect(aliasVariant?.code).toContain("useEffect(__reactDoctorFuzzEffectCallback0, [url]);");
    expect(aliasVariant?.code).toContain(
      "React.useLayoutEffect(__reactDoctorFuzzEffectCallback1, []);",
    );
    expect(aliasVariant?.code).toContain(
      "useInsertionEffect(__reactDoctorFuzzEffectCallback2, []);",
    );
    expect(runRule(NOOP_RULE, aliasVariant?.code ?? "").parseErrors).toEqual([]);
  });
});
