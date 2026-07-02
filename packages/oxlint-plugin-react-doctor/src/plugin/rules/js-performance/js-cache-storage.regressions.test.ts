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

  it("flags a function-body read plus a nested iteration-callback read of the same key", () => {
    expectFail(`function hydrateCart(items) {
      const raw = localStorage.getItem("cart");
      items.forEach((item) => {
        const again = localStorage.getItem("cart");
        console.log(raw, again, item);
      });
    }`);
  });

  it("flags two reads of the same key inside one reduce callback and its enclosing function", () => {
    expectFail(`function total(items) {
      const currency = localStorage.getItem("currency");
      return items.reduce((sum, item) => sum + convert(item, localStorage.getItem("currency")), 0);
    }`);
  });

  it("does not sum iteration-callback reads across unrelated functions", () => {
    expectPass(`function first(items) {
      items.forEach(() => localStorage.getItem("t"));
    }
    function second(items) {
      items.map(() => localStorage.getItem("t"));
    }`);
  });

  it("does not treat a non-iteration inline callback as part of the enclosing function", () => {
    expectPass(`function C() {
      useEffect(() => {
        const data = localStorage.getItem("slugs");
        console.log(data);
      }, []);
      const reset = () => localStorage.getItem("slugs");
      return reset;
    }`);
  });
});
