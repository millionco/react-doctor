import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsCombineIterations } from "./js-combine-iterations.js";

const chainWithCallback = (callback: string): string =>
  `const select = (values) => values.map((value) => ({score: value * value})).filter(${callback});`;

describe("js-combine-iterations completed callback array", () => {
  it.each([
    `(value, index, all) => value.score < all[all.length - 1].score`,
    `(value, index, all) => index < all.length`,
    `(value, index, {length: count}) => index < count`,
    `(value, index, {2: ignored = record()}) => value.score > 0`,
    `(value, index, [,, {score: ignored}]) => value.score > 0`,
    `(value, index, {[selectKey()]: ignored}) => value.score > 0`,
    `(value, index, [first, ...remaining]) => value !== remaining[0]`,
    `(value, index, all) => { const completed = all; return index < completed.length; }`,
    `(value, index, all, size = all.length) => index < size`,
    `(value, index, all) => { const nested = () => all.length; return index < nested(); }`,
    `(value, index, all) => { const nested = function () { return all.length; }; return index < nested(); }`,
    `function (value, index) { return index < arguments[2].length; }`,
    `function (value, index) { const frame = arguments; return index < frame[2].length; }`,
    `function (value, index) { const [,, completed] = arguments; return index < completed.length; }`,
    `function (value, index) { const {2: completed} = arguments; return index < completed.length; }`,
    `function (value, index) { const [,, {2: ignored = record()}] = arguments; return value.score > 0; }`,
    `function (value, index) { return (() => index < arguments[2].length)(); }`,
    `function (value, index, all, size = arguments[2].length) { return index < size; }`,
    `(value, ...tail) => tail[1].length > 0`,
    `(value, index, ...tail) => tail[0].length > 0`,
    `(...parts) => parts[2].length > 0`,
    `(...[, , completed]) => completed.length > 0`,
    `(...{2: completed}) => completed.length > 0`,
    `(value, ...tail) => { const frame = tail; return frame[1].length > 0; }`,
    `function (...parts) { return arguments[2].length > 0; }`,
    `function (...parts) { return (() => arguments[2].length > 0)(); }`,
    `(value, index, all) => eval("all.length > index")`,
    `(value, index, all) => (eval)("all.length > index")`,
    `function (value, index) { return eval("arguments[2].length > index"); }`,
    `(value, index, all) => { const nested = function () { return eval("all.length"); }; return index < nested(); }`,
    `(value, index, all) => { type all = unknown; return index < all.length; }`,
    `(value, index, all) => { const nested = (size = all.length) => { var all; return size; }; return index < nested(); }`,
    `(value, index, all, size = all.length) => { var all; return index < size; }`,
  ])("declines an observed or unproved completed array: %s", (callback) => {
    const result = runRule(jsCombineIterations, chainWithCallback(callback), {
      filename: "/project/src/select.ts",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `(value, index, all) => value.score > 0`,
    `(value, index, {length: ignored}) => value.score > 0`,
    `(value, index, [ignored]) => value.score > 0`,
    `(value, index, all) => { const accepts = (all) => all > 0; return accepts(value.score); }`,
    `function (value, index, all) { return (function (all) { return all > 0; })(value.score); }`,
    `function (value) { const nested = function () { return arguments[2]; }; return value.score > 0; }`,
    `function (value) { return arguments[0].score > 0; }`,
    `function (value) { return arguments[1] >= 0; }`,
    `function (value) { return arguments.length > 0; }`,
    `function (value) { const [first] = arguments; return first.score > 0; }`,
    `function (value) { const {length: count} = arguments; return count > 0; }`,
    `(value, ...tail) => tail[0] >= 0`,
    `(...parts) => parts[0].score > 0`,
    `(...parts) => parts[1] >= 0`,
    `(...parts) => parts.length > 0`,
    `(...[value, index]) => value.score > 0`,
    `(...{0: value, 1: index}) => value.score > 0`,
    `(value, index, all) => { const name = "eval"; return value.score > 0; }`,
    `(value, index, all) => helper.eval(value.score)`,
  ])("retains fusion advice without that dependency: %s", (callback) => {
    const result = runRule(jsCombineIterations, chainWithCallback(callback), {
      filename: "/project/src/select.ts",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `(value, index, all) => all.indexOf(value) === index`,
    `(value, index, all) => { return all.indexOf(value) === index; }`,
    `function (value, index, all) { return all.indexOf(value) === index; }`,
    `function (this: unknown, value, index, all) { return all.indexOf(value) === index; }`,
    `(value, index, all) => ((all).indexOf((value))) === (index)`,
  ])("retains the exact prefix-only first occurrence filter: %s", (callback) => {
    const result = runRule(jsCombineIterations, chainWithCallback(callback), {
      filename: "/project/src/select.ts",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `(value, index, all) => all.indexOf(value, 0) === index`,
    `(value, index, all) => all.indexOf(value, change()) === index`,
    `(value, index, all) => all["indexOf"](value) === index`,
    `(value, index, all) => all.indexOf?.(value) === index`,
    `(value, index, all) => all?.indexOf(value) === index`,
    `(value, index, all) => all.lastIndexOf(value) === index`,
    `(value, index, all) => all.includes(value) === index`,
    `(value, index, all) => value && all.indexOf(value) === index`,
    `(value, index, all) => { change(); return all.indexOf(value) === index; }`,
    `(value, index, all) => { const alias = all; return alias.indexOf(value) === index; }`,
    `(value, index, all) => all.indexOf(otherValue) === index`,
    `(value, index, all) => all.indexOf(value) === otherIndex`,
    `(value, index, all) => all.indexOf(value = otherValue) === index`,
    `(value, index, all) => all.indexOf(value) === (index = 0)`,
    `(value, index, all) => { all = otherArray; return all.indexOf(value) === index; }`,
    `(value, index, all = otherArray) => all.indexOf(value) === index`,
  ])("does not grant a wider prefix certificate: %s", (callback) => {
    const result = runRule(jsCombineIterations, chainWithCallback(callback), {
      filename: "/project/src/select.ts",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      code: `const eval = globalThis.eval; ${chainWithCallback('(value, index, all) => eval("all.length > index")')}`,
      count: 0,
    },
    {
      code: chainWithCallback(
        `function (value, index, all) { with (provider) { return index < all.length; } }`,
      ),
      count: 0,
    },
    {
      code: chainWithCallback(
        `function arguments(value, index) { return index < arguments[2].length; }`,
      ),
      count: 0,
    },
    {
      code: chainWithCallback(
        `function (value, index) { var arguments; return index < arguments[2].length; }`,
      ),
      count: 0,
    },
    {
      code: chainWithCallback(
        `function (value, index, arguments) { return index < arguments.length; }`,
      ),
      count: 0,
    },
    {
      code: chainWithCallback(`function (arguments, index) { return arguments.score > 0; }`),
      count: 1,
    },
    {
      code: chainWithCallback(
        `function (value) { return ((arguments) => arguments[0] > 0)([value.score]); }`,
      ),
      count: 1,
    },
    {
      code: `function outer(arguments, values) { return values.map(value => value * 2).filter(function (value, index) { return index < arguments[2].length; }); }`,
      count: 0,
    },
    {
      code: chainWithCallback(
        `function (value, value, all) { return all.indexOf(value) === value; }`,
      ),
      count: 0,
    },
  ])("uses valid script-mode bindings and scope: $code", ({ code, count }) => {
    const result = runRule(jsCombineIterations, code, { filename: "/project/src/select.cjs" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(count);
  });

  it("distinguishes an arrow's lexical arguments from its native callback arguments", () => {
    const result = runRule(
      jsCombineIterations,
      `
      const select = function (values, ignored, threshold) {
        return values.map(value => value * 2).filter(value => value > arguments[2]);
      };
    `,
      { filename: "/project/src/select.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps the inner mapper's original input available", () => {
    const result = runRule(
      jsCombineIterations,
      `
      const select = values => values.map((value, index, original) => value + original[original.length - 1]).filter(value => value > 6);
    `,
      { filename: "/project/src/select.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports an earlier fusible pair after declining the outer pair", () => {
    const result = runRule(
      jsCombineIterations,
      `
      const select = values => values.map(value => value + 1).map(value => value * 2).filter((value, index, all) => value < all[all.length - 1]);
    `,
      { filename: "/project/src/select.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("leaves named callback resolution outside this finite change", () => {
    const result = runRule(
      jsCombineIterations,
      `
      const keep = (value, index, all) => value < all[all.length - 1];
      const select = values => values.map(value => value * 2).filter(keep);
    `,
      { filename: "/project/src/select.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves the legacy unresolved provider classification", () => {
    const result = runRule(
      jsCombineIterations,
      `
      import { Optional } from "@ephox/katamari";
      const select = value => Optional.some(value).map(item => item * 2).filter(item => item > 0);
    `,
      { filename: "/project/src/select.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves strict indexOf behavior for holes and NaN", () => {
    const values = [NaN, , 1, 1, undefined];
    expect(values.filter((value, index, all) => all.indexOf(value) === index)).toEqual([
      1,
      undefined,
    ]);
  });

  it.each([
    `Array.prototype.indexOf = function (value) { return this[this.length - 1] === value ? 0 : -1; };`,
    `Object.defineProperty(Array.prototype, "indexOf", {value: function (value) { return this[this.length - 1] === value ? 0 : -1; }});`,
  ])("does not certify a visibly replaced native method: %s", (override) => {
    const result = runRule(
      jsCombineIterations,
      `${override} ${chainWithCallback("(value, index, all) => all.indexOf(value) === index")}`,
      { filename: "/project/src/select.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("preserves the default-off and production-file policies", () => {
    expect(jsCombineIterations.defaultEnabled).toBe(false);
    const result = runRule(jsCombineIterations, chainWithCallback("value => value.score > 0"), {
      filename: "/project/src/select.test.ts",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
