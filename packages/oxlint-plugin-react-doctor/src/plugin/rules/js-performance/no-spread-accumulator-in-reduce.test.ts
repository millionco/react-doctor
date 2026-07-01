import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSpreadAccumulatorInReduce } from "./no-spread-accumulator-in-reduce.js";

describe("no-spread-accumulator-in-reduce", () => {
  it("flags object spread of the accumulator", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = keys.reduce((acc, key) => ({ ...acc, [key]: value }), {});`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags array spread of the accumulator", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduce((acc, x) => [...acc, x], []);`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a multi-line concise body with distinct param names", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const out = members.reduce(
        (partialOrgMembers, member) => ({
          ...partialOrgMembers,
          [member.id]: member,
        }),
        {},
      );
    `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags reduceRight too", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduceRight((acc, x) => ({ ...acc, [x]: 1 }), {});`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an explicit return of the spread literal (block body)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const out = keys.reduce((acc, key) => {
        return { ...acc, [key]: 1 };
      }, {});
    `
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a single static-key merge (bounded shape, O(n))", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const merged = items.reduce((acc, item) => ({ ...acc, label: item.name }), {});`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fixed-shape accumulator built from static keys across returns", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const address = components.reduce((acc, component) => {
        if (component.types.includes("locality")) return { ...acc, city: component };
        if (component.types.includes("region")) return { ...acc, state: component };
        return { ...acc, country: component };
      }, {});
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a second spread merged into the accumulator (unbounded keys)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = values.reduce((acc, value) => ({ ...acc, ...getBoxMod(value) }), {});`
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag mutate-and-return (the correct O(n) idiom)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const out = lines.reduce((acc, line) => {
        acc[line.key] = line.value;
        return acc;
      }, {});
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag spreading the current item (O(1) per step)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduce((acc, x) => ({ ...x, foo: acc.foo }), {});`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Object.assign(acc, ...)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const out = items.reduce((acc, x) => {
        return Object.assign(acc, { [x]: 1 });
      }, {});
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a member/call spread root (...acc.items)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduce((acc, x) => ({ ...acc.items, [x]: 1 }), {});`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag other reduce shapes with a numeric accumulator", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const total = items.reduce((sum, x) => sum + x, 0);`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not fire on a non-reduce method named similarly", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.map((acc, x) => ({ ...acc, [x]: 1 }));`
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not confuse an inner callback's spread for the reducer's return", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const out = items.reduce((acc, x) => {
        const mapped = x.values.map((v) => ({ ...v, done: true }));
        acc[x.id] = mapped;
        return acc;
      }, {});
    `
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
