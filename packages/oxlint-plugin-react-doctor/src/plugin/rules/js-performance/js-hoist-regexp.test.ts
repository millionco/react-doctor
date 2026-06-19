import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsHoistRegexp } from "./js-hoist-regexp.js";

describe("js-hoist-regexp", () => {
  it("flags `new RegExp(...)` built inside a loop body", () => {
    const result = runRule(
      jsHoistRegexp,
      `function fn(rows) { for (const row of rows) { const re = new RegExp(row.pattern); test(re); } }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a `new RegExp(...)` outside any loop", () => {
    const result = runRule(jsHoistRegexp, `const re = new RegExp(pattern);`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a `new RegExp(...)` inside a callback that merely escapes the loop", () => {
    // Regression: the regexp is built per-click, not per-iteration —
    // the click handler is a separate function with its own acyclic
    // CFG, so cycle-based loop membership must report nothing.
    const result = runRule(
      jsHoistRegexp,
      `function fn(rows) {
        for (const row of rows) {
          row.element.onclick = () => { const re = new RegExp(row.pattern); test(re); };
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
