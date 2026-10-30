import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { noRefCurrentInRender } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-ref-current-in-render.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";

const fixtureDirectory = new URL(
  "../corpus/regressions/no-ref-current-in-render--typed-redux/",
  import.meta.url,
);
const fixturePath = fileURLToPath(new URL("panel.tsx", fixtureDirectory));
const fixtureCode = readFileSync(fixturePath, "utf8");

describe("typed Redux store ref corpus", () => {
  it("preserves the complete factory context", () => {
    const result = runRule(noRefCurrentInRender, fixtureCode, { filename: fixturePath });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["(makeStore())", "(makeStore() as Store)", "(makeStore() satisfies Store)"])(
    "preserves transparent initialization %s",
    (expression) => {
      const code = fixtureCode.replace("= makeStore();", `= ${expression};`);
      const result = runRule(noRefCurrentInRender, code, { filename: fixturePath });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("keeps custom provider context unsupported", () => {
    const code = fixtureCode.replace(
      "<Provider store=",
      "<Provider context={customContext} store=",
    );
    const result = runRule(noRefCurrentInRender, code, { filename: fixturePath });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("checks the corpus verdict with an absolute consumer path", () => {
    const corpus = loadFuzzCorpus(fileURLToPath(fixtureDirectory)).map((entry) => ({
      ...entry,
      sourcePath: fileURLToPath(new URL(entry.relativePath, fixtureDirectory)),
    }));
    expect(corpus.find((entry) => entry.relativePath === "panel.tsx")?.verdict).toBe("pass");
    const result = fuzzRuleWithStats("no-ref-current-in-render", noRefCurrentInRender, {
      iterations: 0,
      corpus,
    });
    expect(result.findings).toEqual([]);
    expect(result.stats.executedProgramCount).toBeGreaterThan(0);
  });
});
