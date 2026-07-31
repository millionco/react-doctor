import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsCombineIterations } from "./js-combine-iterations.js";

const expectFail = (code: string): void => {
  const result = runRule(jsCombineIterations, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsCombineIterations, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-combine-iterations — regressions", () => {
  it("flags a real predicate in a filter().map() chain", () => {
    expectFail(`const r = items.filter(x => x.active).map(x => x.id);`);
  });

  it("flags a real predicate in a map().filter() chain", () => {
    expectFail(`const r = items.map(x => x.id).filter(x => x > 0);`);
  });

  it("does not flag filter(Boolean).map() identity narrowing", () => {
    expectPass(`const r = items.filter(Boolean).map(x => x.id);`);
  });

  it("does not flag filter(Boolean).forEach() (treeview utils.ts mined FP)", () => {
    expectPass(`items.filter(Boolean).forEach(x => sink(x));`);
  });

  it("does not flag filter(x => x).forEach()", () => {
    expectPass(`items.filter(x => x).forEach(x => sink(x));`);
  });

  it("does not flag filter(Boolean).filter() adjacency", () => {
    expectPass(`const r = items.filter(Boolean).filter(x => x.active);`);
  });

  it("does not flag map().filter(Boolean)", () => {
    expectPass(`const r = items.map(x => x.id).filter(Boolean);`);
  });

  it("does not flag a block-body identity filter(x => { return x; }).map()", () => {
    expectPass(`const r = items.filter(x => { return x; }).map(x => x.id);`);
  });

  it("does not flag a double-negation filter(x => !!x).map()", () => {
    expectPass(`const r = items.filter(x => !!x).map(x => x.id);`);
  });

  it("still flags a real predicate in filter().forEach()", () => {
    expectFail(`items.filter(x => x.active).forEach(x => sink(x));`);
  });

  it("still flags a real predicate over Array.from (dominant-class exemption deferred)", () => {
    expectFail(
      `const ids = Array.from(idsToUpdate).filter((id) => isBranchNode(data, id)).map((id) => ({ id }));`,
    );
  });

  // Prod telemetry review 2026-07: a single fluent chain with N adjacent
  // chainable pairs reported N-1 times (same line, same advice) —
  // CodeMirrorEditor `rows.filter().map().filter().sort()` produced two
  // identical diagnostics. One report per chain is enough.
  it("reports a three-step chain exactly once", () => {
    const result = runRule(
      jsCombineIterations,
      `const r = rows.filter((r) => r !== headerRow).map((r) => bodyRows.indexOf(r)).filter((i) => i >= 0);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a four-step chain exactly once", () => {
    const result = runRule(
      jsCombineIterations,
      `const r = items.filter((x) => x.active).map((x) => x.id).filter((i) => i > 0).map((i) => i * 2);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // When the outermost pair is exempt (nullish-narrowing filter), the
  // inner pair must still report — the chain is not silently swallowed.
  it("still reports the inner pair once when the outermost pair is exempt", () => {
    const result = runRule(
      jsCombineIterations,
      `const r = Object.entries(selected).filter(([, isSelected]) => isSelected).map(([id]) => columns.find((c) => c.id === id)).filter((c) => c != null);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  // Docs-validation r2: PortOS JobsTab `BRIEFING_CONFIG_OPTIONS.filter().map()`
  // — the receiver is a module-scope const literal of 3 entries, the doc's
  // tiny-N carve-out, but the inline-literal guard missed the named form.
  it("does not flag a chain rooted at a small module-scope const array literal", () => {
    expectPass(`
      const BRIEFING_CONFIG_OPTIONS = [
        { key: 'dailyJoke', label: 'Daily Joke' },
        { key: 'dailyQuote', label: 'Daily Quote' },
        { key: 'dailyImage', label: 'Daily Image' },
      ];
      const badges = BRIEFING_CONFIG_OPTIONS.filter(o => config[o.key]).map(o => o.label);
    `);
  });

  it("does not flag an exported small const array literal chain", () => {
    expectPass(`
      export const SIZES = ['sm', 'md', 'lg'];
      const labels = SIZES.filter(s => s !== 'md').map(s => s.toUpperCase());
    `);
  });

  it("does not flag a nine-element readonly const array literal chain", () => {
    expectPass(`
      export const COLUMNS = [
        { key: 'one' },
        { key: 'two' },
        { key: 'three' },
        { key: 'four' },
        { key: 'five' },
        { key: 'six' },
        { key: 'seven' },
        { key: 'eight' },
        { key: 'nine' },
      ] as const;
      const keys = COLUMNS.filter(column => column.key !== 'nine').map(column => column.key);
    `);
  });

  it("does not flag a single-use local var initialized with a small literal", () => {
    expectPass(`
      const selectSides = (value) => {
        var sides = ['top', 'right', 'bottom', 'left', 'horizontal', 'vertical'];
        return sides.filter(side => value[side]).map(side => side + '-' + value[side]);
      };
    `);
  });

  it("still flags an object-destructured prop with a small literal default", () => {
    expectFail(`
      const getLabels = (props) => {
        const { items = ['one', 'two', 'three'] } = props;
        return items.filter(item => item !== 'two').map(item => item.toUpperCase());
      };
    `);
  });

  it("still flags an array-destructured value with a small literal default", () => {
    expectFail(`
      const getLabels = (values) => {
        const [items = ['one', 'two', 'three']] = values;
        return items.filter(item => item !== 'two').map(item => item.toUpperCase());
      };
    `);
  });

  it("still flags a local var that is mutated before the chain", () => {
    expectFail(`
      const selectSides = (value) => {
        var sides = ['top', 'right', 'bottom', 'left'];
        sides.push(value.extraSide);
        return sides.filter(side => value[side]).map(side => side + '-' + value[side]);
      };
    `);
  });

  it("still flags a const array that is mutated before the chain", () => {
    expectFail(`
      const sides = ['top', 'right', 'bottom', 'left'];
      sides.push(extraSide);
      const labels = sides.filter(side => selected[side]).map(side => side.toUpperCase());
    `);
  });

  it("still flags a local var that escapes before the chain", () => {
    expectFail(`
      const selectSides = (value) => {
        var sides = ['top', 'right', 'bottom', 'left'];
        extendSides(sides);
        return sides.filter(side => value[side]).map(side => side + '-' + value[side]);
      };
    `);
  });

  it("still flags a const array that escapes before the chain", () => {
    expectFail(`
      const sides = ['top', 'right', 'bottom', 'left'];
      extendSides(sides);
      const labels = sides.filter(side => selected[side]).map(side => side.toUpperCase());
    `);
  });

  it("still flags a reassigned transpiled var", () => {
    expectFail(`
      var sides = ['top', 'right', 'bottom', 'left'];
      sides = loadSides();
      const labels = sides.filter(side => selected[side]).map(side => side.toUpperCase());
    `);
  });

  it("does not flag a fixed small literal with a hole", () => {
    expectPass(`
      const slots = ['header', , 'content', 'footer'];
      const labels = slots.filter(slot => slot !== 'footer').map(slot => String(slot));
    `);
  });

  it("still flags a dynamically sized computed array", () => {
    expectFail(`
      const slots = Array.from({ length: slotCount }, (_, index) => index);
      const labels = slots.filter(slot => slot > 0).map(slot => String(slot));
    `);
  });

  it("still flags a chain rooted at a large module-scope const array literal", () => {
    expectFail(`
      const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const r = ROWS.filter(x => x > 2).map(x => x * 2);
    `);
  });

  it("still flags a chain rooted at a let-declared array literal", () => {
    expectFail(`
      let rows = [1, 2, 3];
      rows = load();
      const r = rows.filter(x => x > 2).map(x => x * 2);
    `);
  });

  it("still flags a chain rooted at a const array with spread", () => {
    expectFail(`
      const ROWS = [...loaded];
      const r = ROWS.filter(x => x > 2).map(x => x * 2);
    `);
  });

  it("still flags a chain whose inner call is wrapped in `as any`", () => {
    expectFail(`const r = (items.filter((x) => x.active) as any).map((x) => x.id);`);
  });

  it("reports two independent chains in one file twice", () => {
    const result = runRule(
      jsCombineIterations,
      `
      const a = items.filter((x) => x.active).map((x) => x.id);
      const b = users.map((u) => u.name).filter((n) => n.length > 0);
      `,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });
});
