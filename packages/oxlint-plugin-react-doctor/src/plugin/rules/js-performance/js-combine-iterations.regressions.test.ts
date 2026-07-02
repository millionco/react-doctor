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

  it("does not flag filter(Boolean).forEach() (treeview utils.ts mined FP)", () => {
    expectPass(`items.filter(Boolean).forEach(x => sink(x));`);
  });

  it("does not flag filter(x => x).forEach()", () => {
    expectPass(`items.filter(x => x).forEach(x => sink(x));`);
  });

  it("does not flag filter(Boolean).filter() adjacency", () => {
    expectPass(`const r = items.filter(Boolean).filter(x => x.active);`);
  });

  it("does not flag map().filter(Boolean)", () => {
    expectPass(`const r = items.map(x => x.id).filter(Boolean);`);
  });

  it("does not flag a block-body identity filter(x => { return x; }).map()", () => {
    expectPass(`const r = items.filter(x => { return x; }).map(x => x.id);`);
  });

  it("does not flag a double-negation filter(x => !!x).map()", () => {
    expectPass(`const r = items.filter(x => !!x).map(x => x.id);`);
  });

  it("still flags a real predicate in filter().forEach()", () => {
    expectFail(`items.filter(x => x.active).forEach(x => sink(x));`);
  });

  it("still flags a real predicate over Array.from (dominant-class exemption deferred)", () => {
    expectFail(
      `const ids = Array.from(idsToUpdate).filter((id) => isBranchNode(data, id)).map((id) => ({ id }));`,
    );
  });
});
