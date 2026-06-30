import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsHoistRegexp } from "./js-hoist-regexp.js";

const expectFail = (code: string): void => {
  const result = runRule(jsHoistRegexp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsHoistRegexp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-hoist-regexp — regressions", () => {
  it("flags a static-pattern `new RegExp(...)` built inside a loop", () => {
    expectFail(`for (const line of lines) { const m = new RegExp("\\\\d+", "gi"); m.test(line); }`);
  });

  it("does not flag `new RegExp(loopVar, ...)` whose pattern depends on the loop", () => {
    expectPass(
      `function h(text, kws){ let o=text; for(const k of kws){ const m=new RegExp(k,"gi"); o=o.replace(m,(x)=>x);} return o; }`,
    );
  });
});
