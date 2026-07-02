import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { asyncParallel } from "./async-parallel.js";

const expectFail = (code: string): void => {
  const result = runRule(asyncParallel, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(asyncParallel, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/async-parallel — regressions", () => {
  it("flags three genuinely independent sequential awaits", () => {
    expectFail(
      `async function load(){ const a = await getA(); const b = await getB(); const c = await getC(); }`,
    );
  });

  it("does not flag when a bare expression-statement await depends on an earlier result", () => {
    expectPass(
      `async function load(){ const user = await getUser(); await trackVisit(user.id); const posts = await getPosts(); }`,
    );
  });
});
