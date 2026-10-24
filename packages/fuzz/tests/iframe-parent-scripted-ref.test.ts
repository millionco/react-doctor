import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { iframeMissingSandbox } from "../../oxlint-plugin-react-doctor/src/plugin/rules/react-builtins/iframe-missing-sandbox.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";

const fixtureDirectory = new URL(
  "../corpus/regressions/iframe-missing-sandbox--parent-scripted-ref/",
  import.meta.url,
);
const fixtureUrl = new URL("panel.tsx", fixtureDirectory);
const fixturePath = fileURLToPath(fixtureUrl);
const fixtureCode = readFileSync(fixturePath, "utf8");

describe("parent-scripted blank iframe regression", () => {
  it("keeps a ref-only local document outside external-embed reporting", () => {
    const result = runRule(iframeMissingSandbox, fixtureCode, { filename: fixturePath });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports an explicit external source despite the same ref", () => {
    const code = fixtureCode.replace(
      "<iframe ref=",
      '<iframe src="https://media.example/preview" ref=',
    );
    expect(code).not.toBe(fixtureCode);
    const result = runRule(iframeMissingSandbox, code, { filename: fixturePath });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("checks the declared standalone corpus verdict", () => {
    const corpus = loadFuzzCorpus(fileURLToPath(fixtureDirectory));
    expect(corpus).toHaveLength(1);
    const result = fuzzRuleWithStats("iframe-missing-sandbox", iframeMissingSandbox, {
      iterations: 0,
      corpus,
    });
    expect(result.findings).toEqual([]);
    expect(result.stats.executedProgramCount).toBeGreaterThan(0);
  });
});
