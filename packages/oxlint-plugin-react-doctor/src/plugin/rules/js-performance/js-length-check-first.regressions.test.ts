import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsLengthCheckFirst } from "./js-length-check-first.js";

const expectFail = (code: string): void => {
  const result = runRule(jsLengthCheckFirst, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsLengthCheckFirst, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-length-check-first — regressions", () => {
  it("flags a bare unguarded .every element comparison", () => {
    expectFail(`function arraysEqual(a, b) {
      return a.every((value, index) => value === b[index]);
    }`);
  });

  it("stays silent behind an `&&` equality guard in the same expression", () => {
    expectPass(`function arraysEqual(a, b) {
      return a.length === b.length && a.every((value, index) => value === b[index]);
    }`);
  });

  it("stays silent behind a preceding statement-level mismatch guard", () => {
    expectPass(`function arraysEqual(a, b) {
      if (a.length !== b.length) return false;
      return a.every((value, index) => value === b[index]);
    }`);
  });

  it("stays silent behind a block-bodied mismatch guard", () => {
    expectPass(`function arraysEqual(a, b) {
      if (a.length !== b.length) { return false; }
      return a.every((value, index) => value === b[index]);
    }`);
  });

  it("stays silent behind a deliberate relational `>` guard (partial input)", () => {
    expectPass(`function validate(characters, segments) {
      if (characters.length > segments.length) return false;
      return characters.every((character, index) => segments[index].test(character));
    }`);
  });

  it("stays silent behind a compound `||` mismatch guard", () => {
    expectPass(`function arraysEqual(a, b) {
      if (!a || a.length !== b.length) return false;
      return a.every((value, index) => value === b[index]);
    }`);
  });

  it("stays silent when the guard sits in an OUTER block", () => {
    expectPass(`function arraysEqual(a, b, deep) {
      if (a.length !== b.length) return false;
      if (deep) {
        return a.every((value, index) => value === b[index]);
      }
      return true;
    }`);
  });

  it("stays silent inside an enclosing statement-form equality gate", () => {
    expectPass(`function arraysEqual(a, b) {
      if (a.length === b.length) {
        return a.every((value, index) => value === b[index]);
      }
      return false;
    }`);
  });

  it("flags when an array is reassigned between guard and comparison", () => {
    expectFail(`function arraysEqual(a, b, extra) {
      if (a.length !== b.length) return false;
      a = a.concat(extra);
      return a.every((value, index) => value === b[index]);
    }`);
  });

  it("flags when a nested function parameter shadows the guarded array", () => {
    expectFail(`function arraysEqual(a, b, x) {
      if (a.length !== b.length) return false;
      const check = (a) => a.every((value, index) => value === b[index]);
      return check(x);
    }`);
  });

  it("stays silent behind a De Morgan `mismatch || !every` guard", () => {
    expectPass(`function applyUrls(oldUrls, newUrls) {
      if (oldUrls.length !== newUrls.length || !oldUrls.every((url, index) => url === newUrls[index])) {
        setUrls(newUrls);
      }
    }`);
  });

  it("stays silent behind a De Morgan guard through optional chaining", () => {
    expectPass(`function sync(products, _products) {
      if (
        products.length !== _products?.length ||
        !products.every((val, index) => val === _products?.[index])
      ) {
        setProducts(products);
      }
    }`);
  });

  it("stays silent when guarded sources are compared via sorted copies", () => {
    expectPass(`function sameTypes(a, b) {
      if (!a || a.length !== b.length) return false;
      const sortedA = [...a].sort();
      const sortedB = [...b].sort();
      return sortedA.every((t, i) => t === sortedB[i]);
    }`);
  });

  it("stays silent behind a relational prefix guard in the same expression", () => {
    expectPass(`const isDescendantOf = (node, ancestor) =>
      node.length >= ancestor.length && ancestor.every((k, i) => k === node[i]);`);
  });

  it("stays silent inside a prefix-named function", () => {
    expectPass(`const isPrefix = (chain, other) =>
      chain.every((id, index) => other[index] === id);`);
  });

  it("stays silent when iterating and indexing the same array", () => {
    expectPass(`function format(strings) {
      strings.every((string, index) => strings[index].length > 0);
    }`);
  });

  it("stays silent when the receiver is a map of the indexed array", () => {
    expectPass(`function unchanged(state) {
      const updatedServers = state.servers.map((s) => update(s));
      if (updatedServers.every((s, i) => s === state.servers[i])) return state;
      return { servers: updatedServers };
    }`);
  });

  it("flags a sorted copy of an UNGUARDED source", () => {
    expectFail(`function sameTypes(a, b) {
      const sortedA = [...a].sort();
      const sortedB = [...b].sort();
      return sortedA.every((t, i) => t === sortedB[i]);
    }`);
  });

  it("flags a bounded slice of the indexed array (length not preserved)", () => {
    expectFail(`function compare(a, b) {
      const head = a.slice(2);
      return head.every((value, index) => value === b[index]);
    }`);
  });
});
