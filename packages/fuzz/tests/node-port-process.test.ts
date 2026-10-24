import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { rulesOfHooks } from "../../oxlint-plugin-react-doctor/src/plugin/rules/react-builtins/rules-of-hooks.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";

const fixtureDirectory = new URL(
  "../corpus/regressions/rules-of-hooks--node-port-process/",
  import.meta.url,
);
const fixturePath = fileURLToPath(new URL("start.js", fixtureDirectory));
const fixtureCode = readFileSync(fixturePath, "utf8");

describe("CommonJS Node utility corpus", () => {
  it("preserves the complete provider context", () => {
    const result = runRule(rulesOfHooks, fixtureCode, { filename: fixturePath });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("checks the corpus verdict with an absolute consumer path", () => {
    const corpus = loadFuzzCorpus(fileURLToPath(fixtureDirectory)).map((entry) => ({
      ...entry,
      sourcePath: fileURLToPath(new URL(entry.relativePath, fixtureDirectory)),
    }));
    expect(corpus.find((entry) => entry.relativePath === "start.js")?.verdict).toBe("pass");
    const result = fuzzRuleWithStats("rules-of-hooks", rulesOfHooks, {
      iterations: 0,
      corpus,
    });
    expect(result.findings).toEqual([]);
    expect(result.stats.executedProgramCount).toBeGreaterThan(0);
  });
});
