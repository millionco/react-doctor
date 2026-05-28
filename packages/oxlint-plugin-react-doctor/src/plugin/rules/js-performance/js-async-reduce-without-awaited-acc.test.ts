import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsAsyncReduceWithoutAwaitedAcc } from "./js-async-reduce-without-awaited-acc.js";

describe("js-async-reduce-without-awaited-acc", () => {
  it("flags async reduce that never awaits the accumulator", () => {
    const code = `
      const build = async (items) =>
        items.reduce(async (acc, item) => {
          acc[item.id] = await getItem(item);
          return acc;
        }, {});
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("acc");
  });

  it("regression: diagnostic message never suggests `const <param> = await <param>` (SyntaxError shape)", () => {
    // `const acc = await acc;` redeclares the parameter `acc` in the same
    // scope, which is a SyntaxError. The message must suggest either
    // bare reassignment (`acc = await acc;`) or restructuring with a
    // distinct previous-param name.
    const code = `
      items.reduce(async (acc, item) => {
        acc[item.id] = await load(item);
        return acc;
      }, {});
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(1);
    // Precise TDZ shape: `const acc = await acc;` followed by `;` or boundary.
    expect(result.diagnostics[0].message).not.toMatch(/const acc = await acc[;,\s]/);
  });

  it("regression: restructure suggestion uses a distinct previous-param when accumulator is already named `previous`", () => {
    // The previous fix hardcoded "previous" as the alt-param. If the
    // user's accumulator is also named `previous`, the suggestion
    // collapses back into a `const previous = await previous;` TDZ
    // ReferenceError. The detector must pick a non-colliding name.
    const code = `
      items.reduce(async (previous, item) => {
        previous[item.id] = await load(item);
        return previous;
      }, Promise.resolve({}));
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(1);
    // The precise TDZ shape is `const previous = await previous;` (followed
    // by `;` or `,`/` ...`). The suggestion must use a distinct alt-name.
    expect(result.diagnostics[0].message).not.toMatch(/const previous = await previous[;,\s]/);
  });

  it("regression: restructure suggestion uses a distinct previous-param when accumulator is named `prev`", () => {
    const code = `
      items.reduce(async (prev, item) => {
        prev[item.id] = await load(item);
        return prev;
      }, Promise.resolve({}));
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).not.toMatch(/const prev = await prev[;,\s]/);
  });

  it("flags async function-expression reducer that never awaits acc", () => {
    const code = `
      items.reduce(async function (acc, item) {
        const value = await fetchItem(item);
        acc.push(value);
        return acc;
      }, []);
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags async reduce with a different accumulator name (totals)", () => {
    const code = `
      items.reduce(async (totals, item) => {
        totals[item.key] = await load(item);
        return totals;
      }, {});
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("totals");
  });

  it("flags async reduceRight that never awaits acc", () => {
    const code = `
      items.reduceRight(async (acc, item) => {
        const value = await load(item);
        acc.push(value);
        return acc;
      }, []);
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag when the accumulator is awaited (canonical correct shape)", () => {
    const code = `
      async function buildObject(items) {
        return items.reduce(async (promise, item) => {
          const obj = await promise;
          obj[item.id] = await getItem(item);
          return obj;
        }, Promise.resolve({}));
      }
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag when accumulator is awaited even if the alias is reassigned", () => {
    const code = `
      items.reduce(async (acc, item) => {
        acc = await acc;
        acc[item.id] = await getItem(item);
        return acc;
      }, Promise.resolve({}));
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a sync reducer (no async keyword)", () => {
    const code = `
      items.reduce((acc, item) => {
        acc[item.id] = item.value;
        return acc;
      }, {});
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag an async reducer that does no awaits at all", () => {
    const code = `
      items.reduce(async (acc, item) => {
        acc[item.id] = item.value;
        return acc;
      }, {});
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags destructured ArrayPattern accumulator with awaits", () => {
    const code = `
      items.reduce(async ([sum, count], item) => {
        const value = await load(item);
        return [sum + value, count + 1];
      }, [0, 0]);
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("destructures its accumulator");
  });

  it("flags destructured ObjectPattern accumulator with awaits", () => {
    const code = `
      items.reduce(async ({ totals }, item) => {
        totals[item.id] = await load(item);
        return { totals };
      }, { totals: {} });
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags destructured accumulator with default value", () => {
    const code = `
      items.reduce(async ({ totals = {} } = {}, item) => {
        totals[item.id] = await load(item);
        return { totals };
      }, undefined);
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag destructured accumulator in a sync reducer", () => {
    const code = `
      items.reduce(([sum, count], item) => {
        return [sum + item.value, count + 1];
      }, [0, 0]);
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag awaits inside a nested function (different async context)", () => {
    const code = `
      items.reduce(async (acc, item) => {
        const acc2 = await acc;
        const inner = async () => await something();
        await inner();
        acc2[item.id] = item.value;
        return acc2;
      }, Promise.resolve({}));
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag reduce that correctly awaits acc on a non-array receiver", () => {
    // v1 doesn't distinguish Array.prototype.reduce from custom
    // .reduce APIs; any callsite that correctly awaits the
    // accumulator is silent.
    const code = `
      stream.reduce(async (acc, x) => {
        const v = await acc;
        v.push(x);
        return v;
      }, Promise.resolve([]));
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags computed string-literal accessor (items['reduce'])", () => {
    const code = `
      items["reduce"](async (acc, item) => {
        acc[item.id] = await load(item);
        return acc;
      }, {});
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags computed string-literal accessor for reduceRight", () => {
    const code = `
      items["reduceRight"](async (acc, item) => {
        acc[item.id] = await load(item);
        return acc;
      }, {});
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag dynamic computed accessor (items[methodName])", () => {
    // Dynamic property paths are unknown — too easy to false-positive.
    // Only string-literal computed accessors are recognized.
    const code = `
      const methodName = "reduce";
      items[methodName](async (acc, item) => {
        acc[item.id] = await load(item);
        return acc;
      }, {});
    `;
    const result = runRule(jsAsyncReduceWithoutAwaitedAcc, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
