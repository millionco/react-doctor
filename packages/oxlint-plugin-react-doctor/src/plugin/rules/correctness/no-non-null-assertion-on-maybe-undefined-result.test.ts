import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNonNullAssertionOnMaybeUndefinedResult } from "./no-non-null-assertion-on-maybe-undefined-result.js";

describe("no-non-null-assertion-on-maybe-undefined-result", () => {
  it("flags .find(predicate)! followed by a member access", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const field = columns.find((col) => col.isKey)!.field;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .findLast(predicate)! followed by a member access", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const value = parts.findLast((d) => d.type === 'group')!.value;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .match(/re/)! followed by an index access", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const first = input.match(/(\\d+)/)![1];`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags map.get(dynamicKey)! when the map is a local bare new Map() never populated in scope", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function read(key) { const lookup = new Map(); return lookup.get(key)!.value; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an index access (not an enumerated callee)", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const item = someArray[i]!.id;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an optional property assertion", () => {
    const result = runRule(noNonNullAssertionOnMaybeUndefinedResult, `const b = obj.foo!.bar;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a loop-guarded queue drain with shift", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `while (frontier.length) { const x = frontier.shift()!.id; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag pop", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const x = stack.pop()!.value;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag map.get with a literal key", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const v = cache.get('fixed')!.value;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag map.get when the map is set in scope", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function build(key) { const map = new Map(); map.set(key, 1); return map.get(key)!.value; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag this.map.get(key)! guarded by this.map.has/set in the same method", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `class C { add(key, cb) { if (!this.listeners.has(key)) { this.listeners.set(key, new Set()); } this.listeners.get(key)!.add(cb); } }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag map.get(id)! in a nested callback when the enclosing function populates the map", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function assign(edges) { const sides = new Map(); for (const e of edges) sides.set(e.id, {}); edges.forEach((e) => { sides.get(e.id)!.side = 1; }); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag map.get on a function parameter (caller-populated invariant map, semiotic computeNode idiom)", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function computeNode(sides, edge) { return sides.get(edge.id)!.top; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag map.get on a call-initialized variable (map built exhaustively by a helper)", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function layout(edges) { const sides = assignSides(edges); for (const e of edges) { e.left = sides.get(e.id)!.left; } }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag this.#field.get(key)! guarded by has/set on the same private field", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `class C { #listeners = new Map(); add(key, cb) { if (!this.#listeners.has(key)) { this.#listeners.set(key, new Set()); } this.#listeners.get(key)!.add(cb); } }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a lookup built via the new Map(entries) constructor", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function pick(options, value) { const lookup = new Map(options.map((o) => [o.value, o])); return lookup.get(value)!.label; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag .match(re)! after the same regex literal was validated with .test (validate-then-extract)", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function parse(line) { if (!/^(\\d+)/.test(line)) return null; return line.match(/^(\\d+)/)![1]; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag .match(re)! after the same regex identifier was validated with .test", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const versionPattern = /v(\\d+)/; function parse(line) { if (!versionPattern.test(line)) return null; return line.match(versionPattern)![1]; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags .match! when a different regex was tested", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function parse(line) { if (!/^#/.test(line)) return null; return line.match(/(\\d+)/)![1]; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a non-dereferenced find assertion", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const found = list.find((x) => x.ok)!;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag .find without a predicate function argument", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const el = $(root).find('.selector')!.first;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in test files", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const field = columns.find((col) => col.isKey)!.field;`,
      { filename: "table.test.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
