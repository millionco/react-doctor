import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsCombineIterations } from "./js-combine-iterations.js";

const expectFail = (code: string): void => {
  const result = runRule(jsCombineIterations, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsCombineIterations, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-combine-iterations — regressions", () => {
  it("flags a real predicate in a filter().map() chain", () => {
    expectFail(`const r = items.filter(x => x.active).map(x => x.id);`);
  });

  it("flags a real predicate in a map().filter() chain", () => {
    expectFail(`const r = items.map(x => x.id).filter(x => x > 0);`);
  });

  it("does not flag filter(Boolean).map() identity narrowing", () => {
    expectPass(`const r = items.filter(Boolean).map(x => x.id);`);
  });
});
