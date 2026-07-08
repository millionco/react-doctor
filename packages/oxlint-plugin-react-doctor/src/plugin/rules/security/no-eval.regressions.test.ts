import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEval } from "./no-eval.js";

describe("security/no-eval — regressions", () => {
  // Docs-validation FP wave: `new Function("return this")` is the ubiquitous
  // globalThis polyfill emitted by webpack/core-js — a constant body with no
  // injectable input (cboard vendored ogv-worker shape).
  it("stays silent on the new Function('return this') globalThis polyfill", () => {
    const result = runRule(noEval, `const globalObject = new Function("return this")();`, {
      filename: "src/runtime/global.ts",
    });
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags new Function with any other constant body", () => {
    const result = runRule(noEval, `const fn = new Function("return 1");`, {
      filename: "src/run.ts",
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags new Function built from dynamic input", () => {
    const result = runRule(noEval, `const fn = new Function("value", userExpression);`, {
      filename: "src/run.ts",
    });
    expect(result.diagnostics).toHaveLength(1);
  });

  // Docs-validation FP wave: a plugin-sandbox runtime executing plugin code
  // inside a null-origin iframe is the exact mitigation the fix guidance
  // recommends (bulwarkmail shape).
  it("stays silent inside sandbox-surface directories", () => {
    const result = runRule(
      noEval,
      `const fn = new Function("module", "exports", "require", code);`,
      { filename: "lib/plugin-sandbox/runtime.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags eval in files merely near a sandbox directory", () => {
    const result = runRule(noEval, `eval(userInput);`, {
      filename: "lib/plugins/host-bridge.ts",
    });
    expect(result.diagnostics).toHaveLength(1);
  });
});
