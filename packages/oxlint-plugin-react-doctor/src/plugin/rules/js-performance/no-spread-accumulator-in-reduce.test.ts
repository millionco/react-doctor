import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSpreadAccumulatorInReduce } from "./no-spread-accumulator-in-reduce.js";

describe("no-spread-accumulator-in-reduce", () => {
  it("does not flag a single-spread keyed-lookup build ({ ...acc, [key]: value })", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = keys.reduce((acc, key) => ({ ...acc, [key]: value }), {});`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
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

  it("does not flag an entity-map fold with a computed key over CMS items (Faqs shape)", () => {
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
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags reduceRight too", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `const out = items.reduceRight((acc, x) => [...acc, x], []);`,
    );
    expect(result.diagnostics).toHaveLength(1);
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

  it("does not flag a filter/dedup shape with an unchanged `return acc` path (growth bounded by matches)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const selected = options.reduce((acc, option) => {
        if (!option.selected) return acc;
        return { ...acc, [option.value]: option };
      }, {});
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
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

  it("does not flag a keyed-lookup build over Object.keys of external data (single spread + computed key)", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      `
      const rows = Object.keys(response.results).reduce(
        (res, rowIdx) => ({ ...res, [rowIdx]: buildRow(response.results[rowIdx]) }),
        {},
      );
    `,
    );
    expect(result.diagnostics).toHaveLength(0);
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

  it("does not flag a fixed-length Array construction", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      "const out = Array.from(Array(4)).reduce((acc, item) => [...acc, item], []);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-growing method on a fixed-length Array construction", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      "const out = Array(4).fill(null).reduce((acc, item) => [...acc, item], []);",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a growing method on a fixed-length Array construction", () => {
    const result = runRule(
      noSpreadAccumulatorInReduce,
      "const out = Array(4).concat(items).reduce((acc, item) => [...acc, item], []);",
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
