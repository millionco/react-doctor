import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSpreadAccumulatorInReduce } from "./no-spread-accumulator-in-reduce.js";

describe("no-spread-accumulator-in-reduce", () => {
  it("flags a single-spread keyed-lookup build ({ ...acc, [key]: value })", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = keys.reduce((acc, key) => ({ ...acc, [key]: value }), {});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags array spread of the accumulator", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduce((acc, x) => [...acc, x], []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an array-accumulator spread over a prop inside useMemo (gazebo Sparkline shape)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const data = useMemo(
        () =>
          datum.reduce((prev, curr, index) => {
            const nextEntry = datum[index + 1];
            return [...prev, { value: select(curr), end: nextEntry }];
          }, []),
        [datum, select],
      );
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an entity-map fold with a computed key over CMS items (Faqs shape)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const expandedById = data.faqCollection.items.reduce(
        (prevExpanded, item) => ({
          ...prevExpanded,
          [item.sys.id]: !allExpanded,
        }),
        {},
      );
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags reduceRight too", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduceRight((acc, x) => [...acc, x], []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports statically computed reducer methods and TypeScript-wrapped callbacks", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const first = items["reduce"]((acc, item) => [...acc, item], []);
       const second = items.reduce((((acc, item) => [...acc, item]) as Reducer), []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not analyze async or generator reducer callbacks", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const asyncResult = items.reduce(async (acc, item) => [...acc, item], []);
       const generatorResult = items.reduce(function* (acc, item) { return [...acc, item]; }, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags an explicit return of the spread literal (block body)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const out = keys.reduce((acc, key) => {
        return { ...acc, ...expandKey(key) };
      }, {});
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a single static-key merge (bounded shape, O(n))", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const merged = items.reduce((acc, item) => ({ ...acc, label: item.name }), {});`,
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
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a second spread merged into the accumulator (unbounded keys)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = values.reduce((acc, value) => ({ ...acc, ...getBoxMod(value) }), {});`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag additional spreads that cannot grow the accumulator", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const sameObject = items.reduce((acc) => ({ ...acc, ...acc }), {});
       const emptyObject = items.reduce((acc) => ({ ...acc, ...{} }), {});
       const emptyArray = items.reduce((acc) => [...acc, ...[]], []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fixed-shape object literal spread", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const labels = items.reduce(
         (acc, item) => ({ ...acc, ...{ label: item.name } }),
         {},
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags object literal spreads with dynamic computed keys", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const labels = items.reduce(
         (acc, item) => ({ ...acc, ...{ [item.id]: item.name } }),
         {},
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an array that spreads the accumulator more than once", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduce((acc) => [...acc, ...acc], []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags growth returned through every conditional branch", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduce(
         (acc, item) => item.ok ? [...acc, item] : [...acc, item],
         [],
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags growth returned through sequence and logical expressions", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const sequenced = items.reduce((acc, item) => (track(item), [...acc, item]), []);
       const logical = items.reduce((acc, item) => item && [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags definite logical growth with a fresh truthy accumulator", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const rightGrowth = items.reduce((acc, item) => acc && [...acc, item], []);
       const leftGrowth = items.reduce((acc, item) => [...acc, item] || acc, []);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps logical expressions that definitely return the accumulator quiet", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const leftAccumulator = items.reduce((acc, item) => acc || [...acc, item], []);
       const rightAccumulator = items.reduce((acc, item) => [...acc, item] && acc, []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores unreachable accumulator passthrough returns", () => {
    const falseBranch = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduce((acc, item) => {
         if (false) return acc;
         return [...acc, item];
       }, []);`,
    );
    expect(falseBranch.diagnostics).toHaveLength(1);

    const unreachableTail = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduce((acc, item) => {
         if (true) return [...acc, item];
         return acc;
       }, []);`,
    );
    expect(unreachableTail.diagnostics).toHaveLength(1);
  });

  it("does not flag mutate-and-return (the correct O(n) idiom)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const out = lines.reduce((acc, line) => {
        acc[line.key] = line.value;
        return acc;
      }, {});
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag spreading the current item (O(1) per step)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduce((acc, x) => ({ ...x, foo: acc.foo }), {});`,
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
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a member/call spread root (...acc.items)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduce((acc, x) => ({ ...acc.items, [x]: 1 }), {});`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag other reduce shapes with a numeric accumulator", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const total = items.reduce((sum, x) => sum + x, 0);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not fire on a non-reduce method named similarly", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.map((acc, x) => ({ ...acc, [x]: 1 }));`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a variadic merge over a rest parameter (AppFlowy-style merge(...objects), bounded by call-site arity)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      function mergeAll(...objects) {
        return objects.reduce((acc, object) => ({ ...acc, ...object }), {});
      }
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps bounded rest parameters quiet through aliases and non-growing wrappers", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const directAlias = (...items) => {
         const boundedItems = items;
         return boundedItems.reduce((acc, item) => [...acc, item], []);
       };
       const wrappedAlias = (...items) => {
         const boundedItems = items as readonly string[];
         return boundedItems!.reduce((acc, item) => [...acc, item], []);
       };
       const selectedAlias = (...items) => {
         const boundedItems = condition ? items : items;
         return boundedItems.reduce((acc, item) => [...acc, item], []);
       };
       const copiedAlias = (...items) => Array.from(items)
         .reduce((acc, item) => [...acc, item], []);
       const slicedAlias = (...items) => items.slice()
         .reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still reports grown, mutable, and externally sourced rest aliases", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const grownAlias = (...items) => {
         const boundedItems = items;
         boundedItems.push(...externalItems);
         return boundedItems.reduce((acc, item) => [...acc, item], []);
       };
       const mutableAlias = (...items) => {
         let selectedItems = items;
         selectedItems = externalItems;
         return selectedItems.reduce((acc, item) => [...acc, item], []);
       };
       const externalAlias = (...items) => {
         const selectedItems = condition ? items : externalItems;
         return selectedItems.reduce((acc, item) => [...acc, item], []);
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags rest parameters that grow before reduce, including through aliases and wrappers", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const append = (...items) => {
         items.push(...externalItems);
         return items.reduce((acc, item) => [...acc, item], []);
       };
       const spliceAlias = (...items) => {
         const alias = condition ? items : items;
         alias.splice(0, 0, ...externalItems);
         return items.reduce((acc, item) => [...acc, item], []);
       };
       const prepend = (...items) => {
         (items as unknown[]).unshift(...externalItems);
         return items.reduce((acc, item) => [...acc, item], []);
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("keeps growth visible through mutable aliases, containers, and unknown calls", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const firstItems = [];
       let alias = firstItems;
       alias.push(...externalItems);
       firstItems.reduce((acc, item) => [...acc, item], []);

       const secondItems = [];
       const box = { items: secondItems };
       box.items.push(...externalItems);
       secondItems.reduce((acc, item) => [...acc, item], []);

       const thirdItems = [];
       appendExternal(thirdItems);
       thirdItems.reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("treats unknown member calls as possible collection growth", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const firstItems = [];
       api.merge(firstItems, externalItems);
       firstItems.reduce((acc, item) => [...acc, item], []);

       const secondItems = [];
       const method = "merge";
       api[method](secondItems, externalItems);
       secondItems.reduce((acc, item) => [...acc, item], []);

       const thirdItems = [];
       thirdItems.mergeExternal(externalItems);
       thirdItems.reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("keeps proven non-growing collection calls bounded", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const firstItems = [];
       Array.from(firstItems);
       Object.keys(firstItems);
       firstItems.slice();
       firstItems.forEach(visit);
       firstItems.reduce((acc, item) => [...acc, item], []);

       const secondItems = [];
       const method = \`merge\`;
       const api = { [method]() {} };
       const methodAlias = method;
       api[methodAlias](secondItems, externalItems);
       secondItems.reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust reassigned local member handlers", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const firstItems = [];
       const firstApi = { merge() {} };
       firstApi.merge = externalMerge;
       firstApi.merge(firstItems, externalItems);
       firstItems.reduce((acc, item) => [...acc, item], []);

       const secondItems = [];
       let secondApi = { merge() {} };
       secondApi = externalApi;
       secondApi.merge(secondItems, externalItems);
       secondItems.reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust mutated global Object and Array aliases", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const BuiltinObject = Object;
       BuiltinObject.keys = () => externalItems;
       BuiltinObject.keys({ first: 1 }).reduce((acc, item) => [...acc, item], []);

       const BuiltinArray = Array;
       BuiltinArray.from = () => externalItems;
       BuiltinArray.from(["first"]).reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("handles long bounded alias chains without repeated growth analysis", () => {
    const aliasDeclarations = Array.from(
      { length: 1_200 },
      (_, index) => `const alias${index + 1} = alias${index};`,
    ).join("\n");
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const alias0 = [];
       ${aliasDeclarations}
       alias1200.reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a reduce over an inline array literal (fixed tiny collection of UI flags)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const flags = ["alpha", "beta"].reduce((acc, name) => ({ ...acc, [name]: true }), {});`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a keyed lookup built from a const array literal of dropdown items", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const dropdownSizes = ["small", "medium", "large"];
      const optionsBySize = dropdownSizes.reduce(
        (acc, size) => ({ ...acc, [size]: renderOption(size) }),
        {},
      );
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Object.keys of a locally constructed object literal (bounded key set)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const iconGlyphs = { plus: "+", minus: "-" };
      const icons = Object.keys(iconGlyphs).reduce(
        (acc, name) => ({ ...acc, [name]: buildIcon(name) }),
        {},
      );
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("supports bounded object aliases, conditional branches, and TypeScript wrappers", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const base = { first: 1 };
       const alias = base as Record<string, number>;
       const selected = condition
         ? alias
         : ({ second: 2 } satisfies Record<string, number>);
       const keys = Object.entries(selected).reduce(
         (acc, [key]) => [...acc, key],
         [],
       );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps object alias mutation visible from the original binding", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const base = { first: 1 };
       const alias = condition ? base : base;
       alias[dynamicKey] = dynamicValue;
       const keys = Object.keys(base).reduce((acc, key) => [...acc, key], []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves bounded object aliases against the correct lexical scope", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const values = { outer: 1 };
       {
         const values = condition ? { inner: 1 } : externalValues;
         const innerKeys = Object.keys(values).reduce((acc, key) => [...acc, key], []);
       }
       const outerKeys = Object.keys(values).reduce((acc, key) => [...acc, key], []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("rejects cyclic, external, mutable, and spread-bearing object sources", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const first = second;
       const second = first;
       const cyclicKeys = Object.keys(first).reduce((acc, key) => [...acc, key], []);
       const selected = condition ? { first: 1 } : externalValues;
       const selectedKeys = Object.keys(selected).reduce((acc, key) => [...acc, key], []);
       let mutable = { first: 1 };
       const mutableKeys = Object.keys(mutable).reduce((acc, key) => [...acc, key], []);
       const spread = { ...externalValues };
       const spreadKeys = Object.keys(spread).reduce((acc, key) => [...acc, key], []);`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("does not treat destructuring defaults as bounded sources", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const { items = ["fallback"] } = props;
       const itemList = items.reduce((acc, item) => [...acc, item], []);
       const { glyphs = {} } = data;
       const glyphNames = Object.keys(glyphs).reduce((acc, key) => [...acc, key], []);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not treat locally constructed collections as bounded after they grow", () => {
    const arrayResult = runRule(
      noSpreadAccumulatorInReduce,
      `const bounded = [seed];
       bounded.push(...items);
       const out = bounded.reduce((acc, item) => [...acc, item], []);`,
    );
    expect(arrayResult.diagnostics).toHaveLength(1);

    const objectResult = runRule(
      noSpreadAccumulatorInReduce,
      `const bounded = {};
       for (const item of items) bounded[item.id] = item;
       const out = Object.keys(bounded).reduce((acc, key) => [...acc, key], []);`,
    );
    expect(objectResult.diagnostics).toHaveLength(1);

    const assignedObjectResult = runRule(
      noSpreadAccumulatorInReduce,
      `const bounded = {};
       Object.assign(bounded, externalValues);
       const out = Object.keys(bounded).reduce((acc, key) => [...acc, key], []);`,
    );
    expect(assignedObjectResult.diagnostics).toHaveLength(1);
  });

  it("tracks growth through transparent receiver wrappers", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const asserted = [seed];
       (asserted as string[]).push(...items);
       const assertedOut = (asserted as string[]).reduce((acc, item) => [...acc, item], []);
       const nonNull = [seed];
       nonNull!.push(...items);
       const nonNullOut = nonNull!.reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not treat shadowed Object.assign as a built-in mutation", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const bounded = { first: true };
       { const Object = { assign() {} }; Object.assign(bounded, externalValues); }
       const out = Object.keys(bounded).reduce((acc, key) => [...acc, key], []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes statically computed built-in object mutators", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const bounded = {};
       Object["defineProperty"](bounded, dynamicKey, { value: true });
       const out = Object.keys(bounded).reduce((acc, key) => [...acc, key], []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes TypeScript-wrapped global Object receivers", () => {
    const safeResult = runRule(
      noSpreadAccumulatorInReduce,
      `const bounded = { first: true, second: true };
       const out = (Object!)["keys"](bounded)
         .reduce((acc, key) => [...acc, key], []);`,
    );
    expect(safeResult.parseErrors).toEqual([]);
    expect(safeResult.diagnostics).toHaveLength(0);

    const grownResult = runRule(
      noSpreadAccumulatorInReduce,
      `const bounded = { first: true };
       (Object as ObjectConstructor).assign(bounded, externalValues);
       const out = Object.keys(bounded).reduce((acc, key) => [...acc, key], []);`,
    );
    expect(grownResult.parseErrors).toEqual([]);
    expect(grownResult.diagnostics).toHaveLength(1);
  });

  it("does not analyze a locally defined custom reducer method", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const custom = { reduce(callback, seed) { return seed; } };
       const out = custom.reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not analyze a custom reducer through const aliases", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const custom = { reduce(callback, seed) { return seed; } };
       const firstAlias = custom;
       const secondAlias = firstAlias as typeof custom;
       const out = secondAlias.reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not analyze a custom reducer with a static template key", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      "const custom = { [`reduce`](callback, seed) { return seed; } }; const out = custom.reduce((acc, item) => [...acc, item], []);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a filter/dedup shape with an unchanged `return acc` path", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const selected = options.reduce((acc, option) => {
        if (!option.selected) return acc;
        return { ...acc, [option.value]: option };
      }, {});
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a shadowed local that reuses the accumulator name (spreads the O(1) local, not the fold)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const out = items.reduce((acc, x) => {
        if (x.override) {
          const acc = x.base;
          return { ...acc, [x.id]: x.value };
        }
        acc[x.id] = x.value;
        return acc;
      }, {});
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags the accumulator spread even when another spread comes first", () => {
    const objectCase = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduce((acc, x) => ({ ...mapItem(x), ...acc }), {});`,
    );
    expect(objectCase.diagnostics).toHaveLength(1);
    const arrayCase = runRule(
      noSpreadAccumulatorInReduce,
      `const out = groups.reduce((acc, g) => [...g.items, ...acc], []);`,
    );
    expect(arrayCase.diagnostics).toHaveLength(1);
  });

  it("flags a keyed-lookup build over Object.keys of external data", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const rows = Object.keys(response.results).reduce(
        (res, rowIdx) => ({ ...res, [rowIdx]: buildRow(response.results[rowIdx]) }),
        {},
      );
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a reduce over a const array behind a ternary initializer (bounded either way)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const providerIds = isGeminiUiFrozen()
        ? ["anthropic", "codex", "opencode"]
        : ["anthropic", "codex", "gemini", "opencode"];
      const rows = providerIds.reduce((acc, providerId) => [...acc, buildRow(providerId)], []);
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a two-spread object merge over external data", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const merged = response.chunks.reduce(
        (acc, chunk) => ({ ...acc, ...normalizeChunk(chunk) }),
        {},
      );
    `,
    );
    expect(result.diagnostics).toHaveLength(1);
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
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an array spread that adds no element", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      "const out = items.reduce((acc) => [...acc], []);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not recommend mutating a shared accumulator seed", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      "const out = items.reduce((acc, item) => [...acc, item], sharedItems);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not recommend mutating an implicit first-element seed", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      "const out = items.reduce((acc, item) => [...acc, item]);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags the real accumulator when a nested block shadows its name", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduce((acc, item) => {
         if (item.preview) {
           const acc = item.preview;
           consume(acc);
         }
         return [...acc, item];
       }, []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat shadowed Object as a bounded built-in enumeration", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const Object = customObjectApi;
       const out = Object.keys({ first: 1, second: 2 }).reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports static computed Object enumeration methods", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const glyphs = { first: "a", second: "b" };
       const out = Object["keys"](glyphs).reduce((acc, key) => [...acc, key], []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust a dynamic computed Object enumeration method", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const glyphs = { first: "a", second: "b" };
       const keys = getEnumerationMethod();
       const out = Object[keys](glyphs).reduce((acc, key) => [...acc, key], []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a fixed-length Array construction", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      "const out = Array.from(Array(4)).reduce((acc, item) => [...acc, item], []);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Array.from with a fixed-length array-like object", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const shape = { length: 4 };
       const direct = Array.from({ length: 4 }).reduce((acc, item) => [...acc, item], []);
       const aliased = Array.from(shape).reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat dynamic or spread-overridden array-like lengths as fixed", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const dynamic = Array.from({ length: itemCount }).reduce((acc, item) => [...acc, item], []);
       const overridden = Array.from({ length: 4, ...externalShape }).reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes TypeScript-wrapped global Array constructions and receivers", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const constructed = (Array as ArrayConstructor)(4)
         .reduce((acc, item) => [...acc, item], []);
       const copied = (Array!)["from"]((Array as ArrayConstructor)(4))
         .reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a multi-argument Array construction as fixed length", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      "const out = Array(4, ...items).reduce((acc, item) => [...acc, item], []);",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a non-growing method on a fixed-length Array construction", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      "const out = Array(4).fill(null).reduce((acc, item) => [...acc, item], []);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag chained non-growing methods on a fixed-length Array construction", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = Array.from(Array(4))
         .fill(null)
         .map((item) => item)
         .reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("supports statically computed non-growing Array methods", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = Array["from"](Array(4))["fill"](null)[\`map\`]((item) => item)
         .reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("supports bounded literal, alias, and conditional Array chains", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const values = condition ? ["a", "b"] : ["c"];
       const mapped = ["a", "b"].map((item) => item)
         .reduce((acc, item) => [...acc, item], []);
       const copied = Array.from(["a", "b"])
         .reduce((acc, item) => [...acc, item], []);
       const filtered = values.filter(Boolean)
         .reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a spread-bearing literal chain as bounded", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = [first, ...items].map((item) => item)
         .reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a growing method on a fixed-length Array construction", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      "const out = Array(4).concat(items).reduce((acc, item) => [...acc, item], []);",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags growing methods after a bounded Array chain", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const concatenated = Array(4).fill(null).concat(items)
         .reduce((acc, item) => [...acc, item], []);
       const flattened = Array(4).fill(null).flatMap(() => items)
         .reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust a shadowed Array constructor", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const Array = createArrayFactory();
       const out = Array(4).fill(null).reduce((acc, item) => [...acc, item], []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust TypeScript-wrapped shadowed Array or Object receivers", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const Array = createArrayFactory();
       const arrayOut = (Array as ArrayConstructor).from(Array(4))
         .reduce((acc, item) => [...acc, item], []);
       const Object = createObjectApi();
       const objectOut = (Object!)["keys"]({ first: true })
         .reduce((acc, key) => [...acc, key], []);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });
});
