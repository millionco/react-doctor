import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEval } from "./no-eval.js";

describe("no-eval", () => {
  it("flags eval() in production code", () => {
    const result = runRule(noEval, `eval(userInput);`, { filename: "src/run.ts" });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("eval()");
  });

  it("flags `new Function(...)` in production code", () => {
    const result = runRule(noEval, `const fn = new Function("return 1");`, {
      filename: "src/run.ts",
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("new Function()");
  });

  it("flags a stringy setTimeout in production code", () => {
    const result = runRule(noEval, `setTimeout("doThing()", 100);`, { filename: "src/run.ts" });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag `new Function(...)` in a `.test.ts` file", () => {
    const result = runRule(noEval, `const fn = new Function("return 1");`, {
      filename: "lib/pages/document/_applyThemeForDocument.test.ts",
    });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag eval() inside a `__tests__` directory", () => {
    const result = runRule(noEval, `eval(userInput);`, {
      filename: "src/__tests__/run.ts",
    });
    expect(result.diagnostics).toHaveLength(0);
  });
});
