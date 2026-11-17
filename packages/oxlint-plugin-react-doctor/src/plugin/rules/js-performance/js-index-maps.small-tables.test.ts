import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsIndexMaps } from "./js-index-maps.js";

const expectCount = (source: string, count: number): void => {
  const result = runRule(jsIndexMaps, source);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(count);
};

describe("js-index-maps small readonly tables", () => {
  it("allows a local fixed exclusion list while processing object keys", () => {
    expectCount(
      `function select(record) {
        const exclusions = ["left", "right", "top", "bottom", "title"];
        const result = {};
        for (const key in record) {
          if (!exclusions.find(entry => entry === key)) result[key] = record[key];
        }
        return result;
      }`,
      0,
    );
  });

  it.each([
    `["north"]`,
    `["a", "b", "c", "d", "e", "f", "g", "h"]`,
    `(["north", "south"] as const)`,
    `(["north", "south"] satisfies readonly string[])`,
    `[1, 2, true, false]`,
  ])("allows a bounded dense primitive literal: %s", (initializer) => {
    expectCount(
      `function select(keys) { const entries = ${initializer}; for (const key of keys) consume((entries as readonly unknown[]).find(entry => key === entry)); }`,
      0,
    );
  });

  it("validates another pure lookup outside the loop", () => {
    expectCount(
      `function select(keys, ignored) {
        const entries = ["north", "south"];
        entries.findIndex(entry => entry !== ignored);
        for (const key of keys) consume(entries.find(entry => entry === key));
      }`,
      0,
    );
  });

  it.each([
    `["a", "b", "c", "d", "e", "f", "g", "h", "i"]`,
    `["north", , "south"]`,
    `["north", ...incoming]`,
    `[{ value: "north" }]`,
    `[/north/]`,
    `[load()]`,
    `incoming`,
  ])("retains uncertain or growing receivers: %s", (initializer) => {
    expectCount(
      `function select(keys, incoming) { const entries = ${initializer}; for (const key of keys) consume(entries.find(entry => entry === key)); }`,
      1,
    );
  });

  it.each([
    `const alias = entries; void alias;`,
    `entries.push(...incoming);`,
    `entries.length = incoming.length;`,
    `entries[50] = "later";`,
    `expose(entries);`,
    `const [first] = entries; void first;`,
    `const { find } = entries; void find;`,
    `const find = entries.find; void find;`,
    `entries["find"](entry => entry === selected);`,
    `entries?.find(entry => entry === selected);`,
    `entries.find?.(entry => entry === selected);`,
  ])("rejects an unsafe receiver reference: %s", (operation) => {
    expectCount(
      `function select(keys, incoming, selected) { const entries = ["north", "south"]; ${operation} for (const key of keys) consume(entries.find(entry => entry === key)); }`,
      1,
    );
  });

  it.each([
    `entries.find((entry, index, all) => entry === grow(all));`,
    `entries.findIndex((entry, index, all) => entry === grow(all));`,
    `entries.find((entry = load()) => entry === selected);`,
    `entries.find((...values) => values[0] === selected);`,
    `entries.find(({ value }) => value === selected);`,
    `entries.find(function(entry) { return entry === selected; });`,
    `entries.find(async entry => entry === selected);`,
    `entries.find(entry => { mutate(); return entry === selected; });`,
    `entries.find(entry => entry === mutate());`,
    `entries.find(entry => entry === target.value);`,
    `entries.find(entry => target.value === entry);`,
    `entries.find(entry => entry === +target);`,
    `entries.find(entry => entry == selected);`,
    `entries.find(entry => entry === selected, expose());`,
  ])("checks every callback, including outside the loop: %s", (operation) => {
    expectCount(
      `function select(keys, selected, target) { const entries = ["north", "south"]; ${operation} for (const key of keys) consume(entries.find(entry => entry === key)); }`,
      1,
    );
  });

  it("does not exempt an impure callback at the reported call", () => {
    expectCount(
      `function select(keys) { const entries = ["north", "south"]; for (const key of keys) consume(entries.find(entry => entry === read(key))); }`,
      1,
    );
  });

  it.each([
    `eval("entries.push(...incoming)");`,
    `(eval)("entries.push(...incoming)");`,
    `function grow() { eval("entries.push(...incoming)"); } grow();`,
    `Function("Array.prototype.find = replacement")();`,
    `const compiler = "Function"; globalThis[compiler]("Array.prototype.find = replacement")();`,
    `if (incoming) Array.prototype.find = replacement;`,
    `Object.defineProperty(Array.prototype, "find", { value: replacement });`,
    `const prototype = Object.getPrototypeOf([]); expose(prototype);`,
    `const prototype = Reflect.getPrototypeOf([]); expose(prototype);`,
    `const prototype = []["__proto__"]; expose(prototype);`,
    `const Constructor = [].constructor; expose(Constructor);`,
    `const Constructor = Array; expose(Constructor);`,
    `const { prototype } = Array; expose(prototype);`,
    `const method = "prototype"; expose(Array[method]);`,
    `expose(globalThis.Array);`,
    `const constructorName = "Array"; expose(globalThis[constructorName]);`,
  ])("declines visible dynamic scope or native capability escapes: %s", (operation) => {
    expectCount(
      `function select(keys, incoming, replacement) { const entries = ["north", "south"]; ${operation} for (const key of keys) consume(entries.find(entry => entry === key)); }`,
      1,
    );
  });

  it("ignores erased types and preserves ordinary Array utilities", () => {
    expectCount(
      `type Transform = Function;
       function select(keys: Array<string>) {
         const entries = ["north", "south"];
         if (!Array.isArray(keys)) return [];
         const copied = Array.from(keys);
         for (const key of copied) consume(entries.find(entry => entry === key));
       }`,
      0,
    );
  });

  it("resolves a shadowed Function binding", () => {
    expectCount(
      `function select(keys, Function) { const entries = ["north", "south"]; Function(); for (const key of keys) consume(entries.find(entry => entry === key)); }`,
      0,
    );
  });

  it.each([
    `function select(keys, eval, incoming) {
      const entries = ["north", "south"];
      eval("entries.push(...incoming)");
      for (const key of keys) consume(entries.find(entry => entry === key));
    }`,
    `function select(keys, scope) {
      const entries = ["north", "south"];
      with (scope) { expose(); }
      for (const key of keys) consume(entries.find(entry => entry === key));
    }`,
  ])("retains warnings for legal script-mode dynamic scope", (source) => {
    const result = runRule(jsIndexMaps, source, { filename: "/project/src/lookup.cjs" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses the actual receiver binding across nested scopes", () => {
    expectCount(
      `function select(keys, unknown) {
        const entries = ["north", "south"];
        for (const key of keys) consume(entries.find(entry => entry === key));
        { const entries = unknown; for (const key of keys) consume(entries.find(entry => entry === key)); }
      }`,
      1,
    );
  });

  it.each([
    `const entries = ["north", "south"]; export function select(keys) { for (const key of keys) consume(entries.find(entry => entry === key)); }`,
    `function select(keys) { let entries = ["north", "south"]; for (const key of keys) consume(entries.find(entry => entry === key)); }`,
  ])("does not broaden nonlocal or mutable bindings", (source) => {
    expectCount(source, 1);
  });

  it("preserves the existing uppercase exemption", () => {
    expectCount(
      `function select(keys) { eval("unrelated()"); for (const key of keys) consume(TABLE.find(entry => entry === key)); }`,
      0,
    );
  });
});
