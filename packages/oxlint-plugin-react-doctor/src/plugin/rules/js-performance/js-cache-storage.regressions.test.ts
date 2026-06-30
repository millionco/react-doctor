import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsCacheStorage } from "./js-cache-storage.js";

const expectFail = (code: string): void => {
  const result = runRule(jsCacheStorage, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsCacheStorage, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-cache-storage — regressions", () => {
  it("flags two reads of the same key within one function", () => {
    expectFail(
      `function f(){ const a = localStorage.getItem("t"); const b = localStorage.getItem("t"); return a === b; }`,
    );
  });

  it("does not sum single reads across unrelated functions", () => {
    expectPass(
      `export const getToken = () => localStorage.getItem("t"); export const hasToken = () => Boolean(localStorage.getItem("t"));`,
    );
  });
});
