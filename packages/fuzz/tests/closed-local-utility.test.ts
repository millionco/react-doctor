import { describe, expect, it } from "vite-plus/test";
import { noMutatingArrayMethodOnPropOrHookResult } from "../../oxlint-plugin-react-doctor/src/plugin/rules/correctness/no-mutating-array-method-on-prop-or-hook-result.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { MODULE_SCOPE_SNIPPET_POOL } from "../src/snippet-pools.js";

describe("closed local utility generator", () => {
  it("generates a strict private utility without treating its parameter as a prop", () => {
    const snippets = MODULE_SCOPE_SNIPPET_POOL.filter((snippet) =>
      snippet.includes("export const fuzzDrainQueue ="),
    );
    expect(snippets).toHaveLength(1);
    const [snippet] = snippets;
    if (!snippet) throw new Error("Missing closed local utility snippet");
    const result = runRule(noMutatingArrayMethodOnPropOrHookResult, snippet);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
