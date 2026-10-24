import * as path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { hookUseState } from "../../oxlint-plugin-react-doctor/src/plugin/rules/react-builtins/hook-use-state.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

const directory = fileURLToPath(
  new URL("../corpus/regressions/hook-use-state--next-query-snapshot/", import.meta.url),
);
const filename = fileURLToPath(
  new URL(
    "../corpus/regressions/hook-use-state--next-query-snapshot/app/search/query-panel.tsx",
    import.meta.url,
  ),
);
const source = readFileSync(filename, "utf8");
const settings = { "react-doctor": { rootDirectory: directory } };

describe("Next query state snapshot corpus", () => {
  it("resolves a relative physical project filename", () => {
    const result = runRule(hookUseState, source, {
      filename: path.relative(process.cwd(), filename),
      settings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("checks the complete project and a mismatched setter inverse", () => {
    const positive = runRule(hookUseState, source, { filename, settings });
    expect(positive.parseErrors).toEqual([]);
    expect(positive.diagnostics).toEqual([]);
    const inverse = runRule(
      hookUseState,
      source.replace("const [params]", "const [params, updateParams]"),
      { filename, settings },
    );
    expect(inverse.parseErrors).toEqual([]);
    expect(inverse.diagnostics).toHaveLength(1);
  });

  it("allows an omitted setter without an authoritative physical project", () => {
    const result = runRule(hookUseState, source, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("replays the declared positive project corpus", () => {
    const result = fuzzRuleWithStats("hook-use-state", hookUseState, {
      iterations: 0,
      settings,
      corpus: [
        {
          code: source,
          relativePath:
            "regressions/hook-use-state--next-query-snapshot/app/search/query-panel.tsx",
          sourcePath: filename,
          verdict: "pass",
          ruleIds: ["hook-use-state"],
        },
      ],
    });
    expect(result.findings).toEqual([]);
    expect(result.stats.executedProgramCount).toBe(1);
    expect(result.stats.skippedParseErrorCount).toBe(0);
  });
});
