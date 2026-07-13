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

  it("stays silent for key and value projections of the same frozen plain object", () => {
    expectPass(`interface KeyBindings {
      next: string;
      previous: string;
    }
    const DEFAULT_KEY_BINDINGS = Object.freeze<KeyBindings>({
      next: "j",
      previous: "k",
    });
    const isKeyBindings = (bindings) =>
      Object.values(DEFAULT_KEY_BINDINGS).every((_, index) => {
        const key = Object.keys(DEFAULT_KEY_BINDINGS)[index];
        return typeof bindings[key] === "string";
      });`);
  });

  it("stays silent for multi-hop const aliases of the same frozen source", () => {
    expectPass(`const DEFAULTS = Object.freeze({ next: "j", previous: "k" });
    const valuesSource = DEFAULTS;
    const keysSource = valuesSource;
    const isComplete = (bindings) =>
      Object.values(valuesSource).every((_, index) =>
        typeof bindings[Object.keys(keysSource)[index]] === "string"
      );`);
  });

  it("stays silent when the frozen source is exported and passed to unknown callers", () => {
    expectPass(`export const DEFAULTS = Object.freeze({ next: "j", previous: "k" });
    registerDefaults(DEFAULTS);
    const isComplete = (bindings) =>
      Object.values(DEFAULTS).every((_, index) =>
        typeof bindings[Object.keys(DEFAULTS)[index]] === "string"
      );`);
  });

  it("flags projections of an imported source whose object shape is unknown", () => {
    expectFail(`import { DEFAULTS } from "./defaults";
    const isComplete = (bindings) =>
      Object.values(DEFAULTS).every((_, index) =>
        typeof bindings[Object.keys(DEFAULTS)[index]] === "string"
      );`);
  });

  it("stays silent for statically computed Object projection methods", () => {
    expectPass(`const DEFAULTS = Object.freeze({ next: "j", previous: "k" });
    const isComplete = (bindings) =>
      (Object["values"] as typeof Object.values)(DEFAULTS).every((_, index) =>
        typeof bindings[Object[\`keys\`](DEFAULTS)[index]] === "string"
      );`);
  });

  it("flags a computed Object.freeze call outside the shared integrity-method boundary", () => {
    expectFail(`const DEFAULTS = Object["freeze"]({ next: "j", previous: "k" });
    const isComplete = (bindings) =>
      Object.values(DEFAULTS).every((_, index) =>
        typeof bindings[Object.keys(DEFAULTS)[index]] === "string"
      );`);
  });

  it("stays silent when keys are iterated and values are indexed", () => {
    expectPass(`const DEFAULTS = Object.freeze({ next: "j", previous: "k" });
    const isComplete = (bindings) =>
      Object.keys(DEFAULTS).every((key, index) =>
        bindings[key] === Object.values(DEFAULTS)[index]
      );`);
  });

  it("stays silent through length-preserving wrappers around complementary projections", () => {
    expectPass(`const DEFAULTS = Object.freeze({ next: "j", previous: "k" });
    const isComplete = (bindings) =>
      [...Object.values(DEFAULTS)].map((value) => value).every((_, index) =>
        typeof bindings[Object.keys(DEFAULTS).toSorted()[index]] === "string"
      );`);
  });

  it("flags length-preserving wrappers around projections from different frozen objects", () => {
    expectFail(`const LEFT = Object.freeze({ next: "j" });
    const RIGHT = Object.freeze({ next: "j", previous: "k" });
    const isComplete = (bindings) =>
      [...Object.values(LEFT)].map((value) => value).every((_, index) =>
        typeof bindings[Object.keys(RIGHT).toSorted()[index]] === "string"
      );`);
  });

  it("flags a non-frozen const plain object", () => {
    expectFail(`const DEFAULTS = { next: "j", previous: "k" } as const;
    const isComplete = (bindings) =>
      Object.values(DEFAULTS).every((_, index) =>
        typeof bindings[Object.keys(DEFAULTS)[index]] === "string"
      );`);
  });

  it("flags key and value projections from different frozen objects", () => {
    expectFail(`const LEFT = Object.freeze({ next: "j" });
    const RIGHT = Object.freeze({ next: "j", previous: "k" });
    const isComplete = (bindings) =>
      Object.values(LEFT).every((_, index) =>
        typeof bindings[Object.keys(RIGHT)[index]] === "string"
      );`);
  });

  it("flags a mutable plain object written between its projections", () => {
    expectFail(`const defaults = { next: "j", previous: "k" };
    const isComplete = (bindings) =>
      Object.values(defaults).every((_, index) => {
        if (index === 0) defaults.extra = "x";
        return typeof bindings[Object.keys(defaults)[index]] === "string";
      });`);
  });

  it("flags a mutable plain object that escapes to an unknown call", () => {
    expectFail(`const defaults = { next: "j", previous: "k" };
    registerDefaults(defaults);
    const isComplete = (bindings) =>
      Object.values(defaults).every((_, index) =>
        typeof bindings[Object.keys(defaults)[index]] === "string"
      );`);
  });

  it("flags object projections whose value getter can change cardinality", () => {
    expectFail(`const defaults = {
      get next() { delete this.previous; return "j"; },
      previous: "k",
    };
    const isComplete = (bindings) =>
      Object.values(defaults).every((_, index) =>
        typeof bindings[Object.keys(defaults)[index]] === "string"
      );`);
  });

  it("flags frozen accessor objects outside the primitive-data boundary", () => {
    expectFail(`const defaults = Object.freeze({
      get next() { return "j"; },
      previous: "k",
    });
    const isComplete = (bindings) =>
      Object.values(defaults).every((_, index) =>
        typeof bindings[Object.keys(defaults)[index]] === "string"
      );`);
  });

  it("stays silent after an ineffective property write to a frozen source", () => {
    expectPass(`const defaults = Object.freeze({ next: "j", previous: "k" });
    defaults.extra = "x";
    const isComplete = (bindings) =>
      Object.values(defaults).every((_, index) =>
        typeof bindings[Object.keys(defaults)[index]] === "string"
      );`);
  });

  it("flags projections of a proxy with runtime-defined own keys", () => {
    expectFail(`const defaults = new Proxy({ next: "j" }, {
      ownKeys: () => Math.random() > 0.5 ? ["next"] : ["next", "previous"],
    });
    const isComplete = (bindings) =>
      Object.values(defaults).every((_, index) =>
        typeof bindings[Object.keys(defaults)[index]] === "string"
      );`);
  });

  it("flags a frozen proxy because its source is not a plain object literal", () => {
    expectFail(`const defaults = Object.freeze(new Proxy({ next: "j" }, {}));
    const isComplete = (bindings) =>
      Object.values(defaults).every((_, index) =>
        typeof bindings[Object.keys(defaults)[index]] === "string"
      );`);
  });

  it("flags repeated effectful source evaluations", () => {
    expectFail(`const isComplete = (bindings) =>
      Object.values(getDefaults()).every((_, index) =>
        typeof bindings[Object.keys(getDefaults())[index]] === "string"
      );`);
  });

  it("flags similarly named methods on a shadowed Object binding", () => {
    expectFail(`const Object = {
      values: (source) => source.left,
      keys: (source) => source.right,
      freeze: (source) => source,
    };
    const defaults = Object.freeze({ left: ["j"], right: ["next", "previous"] });
    const isComplete = (bindings) =>
      Object.values(defaults).every((_, index) =>
        typeof bindings[Object.keys(defaults)[index]] === "string"
      );`);
  });

  it("flags a reassignable alias even when it starts from a frozen object", () => {
    expectFail(`const DEFAULTS = Object.freeze({ next: "j" });
    let source = DEFAULTS;
    source = getOtherDefaults();
    const isComplete = (bindings) =>
      Object.values(source).every((_, index) =>
        typeof bindings[Object.keys(DEFAULTS)[index]] === "string"
      );`);
  });

  it("flags complementary projections through distinct frozen roots", () => {
    expectFail(`const LEFT = Object.freeze({ next: "j" });
    const RIGHT = Object.freeze({ previous: "k" });
    const valuesSource = LEFT;
    const keysSource = RIGHT;
    const isComplete = (bindings) =>
      Object.values(valuesSource).every((_, index) =>
        typeof bindings[Object.keys(keysSource)[index]] === "string"
      );`);
  });
});
