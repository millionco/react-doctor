import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsIndexMaps } from "./js-index-maps.js";

const expectFail = (code: string): void => {
  const result = runRule(jsIndexMaps, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsIndexMaps, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-index-maps — regressions", () => {
  it("flags a single-field equality `.find()` inside a loop", () => {
    expectFail(
      `function g(ids, users){ const out=[]; for(const id of ids){ out.push(users.find((u)=> u.id === id)); } return out; }`,
    );
  });

  it("does not flag a range / multi-condition `.find()` predicate", () => {
    expectPass(
      `function g(scores,bands){ const out=[]; for(const sc of scores){ const b=bands.find((b)=> sc>=b.min && sc<=b.max); out.push(b);} return out; }`,
    );
  });

  it("flags a loop-invariant receiver `.find()` inside a loop", () => {
    expectFail(
      `function f(rows, users){ for (const row of rows){ const u = users.find((u)=> u.id === row.userId); use(u); } }`,
    );
  });

  it("does not flag when the `.find()` receiver varies per loop iteration", () => {
    expectPass(
      `function f(rows, targetId){ for (const row of rows){ const cell = row.cells.find((c)=> c.id === targetId); use(cell); } }`,
    );
  });
});
