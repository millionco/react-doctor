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

  it("does not flag map.get after a missing key is populated", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const group = (items, key) => {
        const groups = new Map();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(...items);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag map.get after a block populates a missing key", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const group = (items, key) => {
        const groups = new Map();
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(...items);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags map.get when missing-key population is not guaranteed", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const group = (items, key, shouldPopulate) => {
        const groups = new Map();
        if (!groups.has(key)) {
          if (shouldPopulate) groups.set(key, []);
        }
        groups.get(key)!.push(...items);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags map.get when a has comparison cannot enter the population branch", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const readValue = (key) => {
        const values = new Map();
        if (values.has(key) === null) values.set(key, []);
        return values.get(key)!.length;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still accepts explicit false boolean forms of the missing-key guard", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const readValue = (key) => {
        const values = new Map();
        if (values.has(key) === false) values.set(key, []);
        return values.get(key)!.length;
      };
      const readOtherValue = (key) => {
        const values = new Map();
        if (values.has(key) !== true) values.set(key, []);
        return values.get(key)!.length;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags map.get when the populated map binding is replaced", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const readValue = (key) => {
        let values = new Map();
        if (!values.has(key)) values.set(key, []);
        values = new Map();
        return values.get(key)!.length;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags map.get when missing-key population only appears in a nested function", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const readValue = (key) => {
        const values = new Map();
        if (!values.has(key)) {
          const populate = () => values.set(key, "ready");
          schedule(populate);
        }
        return values.get(key)!.length;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("requires a stable key and definitely present populated value", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const readValues = (obj, nextKey) => {
        const first = new Map();
        if (!first.has(nextKey)) first.set(nextKey, undefined);
        first.get(nextKey)!.length;

        const second = new Map();
        if (!second.has(getKey())) second.set(getKey(), []);
        second.get(getKey())!.length;

        const third = new Map();
        if (!third.has(obj.key)) third.set(obj.key, []);
        obj.key = nextKey;
        third.get(obj.key)!.length;
      };`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags map.get when the proven key changes before lookup", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const group = (items, initialKey, nextKey) => {
        const groups = new Map();
        let key = initialKey;
        if (!groups.has(key)) groups.set(key, []);
        key = nextKey;
        groups.get(key)!.push(...items);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags map.get when the proven entry is deleted before lookup", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const group = (items, key) => {
        const groups = new Map();
        if (!groups.has(key)) groups.set(key, []);
        groups.delete(key);
        groups.get(key)!.push(...items);
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags map.get when the key is changed or deleted after population inside the branch", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const group = (items, initialKey, nextKey) => {
        const first = new Map();
        let firstKey = initialKey;
        if (!first.has(firstKey)) {
          first.set(firstKey, []);
          firstKey = nextKey;
        }
        first.get(firstKey)!.push(...items);

        const second = new Map();
        if (!second.has(initialKey)) {
          second.set(initialKey, []);
          second.delete(initialKey);
        }
        second.get(initialKey)!.push(...items);
      };`,
    );
    expect(result.diagnostics).toHaveLength(2);
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

  it("still flags when the same regex was tested against a different receiver", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function parse(first, second) {
        if (!/x/.test(first)) return null;
        return second["match"](/x/)![0].trim();
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an assertion in the known-missing match branch", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `if (!line.match(/x/)) line.match(/x/)![0].trim();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports a statically computed find method", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const value = rows["find"]((row) => row.id === id)!.value;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a locally shadowed Map constructor as the built-in", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `class Map { get() { return { value: 1 }; } }
      const lookup = new Map();
      const value = lookup.get(key)!.value;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags when a different map key was populated", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const lookup = new Map();
      lookup.set(firstKey, { value: 1 });
      const value = lookup.get(secondKey)!.value;`,
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

  it("does not flag find! guarded by .some with the identical predicate (validate-then-extract)", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function selectUser(users: User[], id: string) {
        if (!users.some((user) => user.id === id)) return null;
        return users.find((user) => user.id === id)!.name;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag find! in a ternary guarded by .some with the identical predicate", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const label = options.some((option) => option.value === value)
        ? options.find((option) => option.value === value)!.label
        : placeholder;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag ensure-then-find (conditional push before find!)", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function addToGroup(groups: Group[], name: string, item: string) {
        if (!groups.some((group) => group.name === name)) {
          groups.push({ name, items: [] });
        }
        groups.find((group) => group.name === name)!.items.push(item);
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags find! when the .some guard uses a different predicate", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function selectUser(users: User[], id: string) {
        if (!users.some((user) => user.isActive)) return null;
        return users.find((user) => user.id === id)!.name;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag find! guarded by .includes on a projection of the same array", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function rowFor(rows: Row[], id: string) {
        const ids = rows.map((row) => row.id);
        if (!ids.includes(id)) return null;
        return rows.find((row) => row.id === id)!.data;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag match! guarded by a truthiness check on the identical match call", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function parseVersion(line: string) {
        if (!line.match(/^v(\\d+)/)) return null;
        return line.match(/^v(\\d+)/)![1];
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag match! with an infallible anchored star regex", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const indents = lines.map((line) => line.match(/^\\s*/)![0].length);
      const firstLine = (text: string) => text.match(/^.*/)![0].trim();`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags match! with a dual-anchored star regex", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const letters = (value: string) => value.match(/^[a-z]*$/)![0];
      const oneLine = (value: string) => value.match(/^.*$/)![0];
      const stickySuffix = (value: string) => value.match(/\\s*$/y)![0];`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("does not flag universal dual-anchored or sticky star regexes", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const dotAll = (value: string) => value.match(/^.*$/s)![0];
      const everyCharacter = (value: string) => value.match(/^[\\s\\S]*$/)![0];
      const stickyDotAll = (value: string) => value.match(/.*$/ys)![0];
      const firstLine = (value: string) => value.match(/^[^\\n]*$/m)![0];
      const stickyFirstLine = (value: string) => value.match(/[^\\r\\n]*$/ym)![0];`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag match! with a g-flagged twin of the tested regex", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function extractTags(text: string) {
        if (!/#\\w+/.test(text)) return [];
        return text.match(/#\\w+/g)!.map((tag) => tag.slice(1));
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag match! validated via a class-field regex (this.pattern)", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `class RouteMatcher {
        private pattern = /^\\/users\\/(\\d+)$/;
        parse(path: string) {
          if (!this.pattern.test(path)) return null;
          return path.match(this.pattern)![1];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag get! on a map passed to a populating helper", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const collectRows = (node: TreeNode, rows: Map<string, number>, depth: number) => {
        rows.set(node.id, depth);
        for (const child of node.children) collectRows(child, rows, depth + 1);
      };
      const TreeSummary = ({ root }: { root: TreeNode }) => {
        const rows = new Map<string, number>();
        collectRows(root, rows, 0);
        return rows.get(root.id)!;
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a literal-key lookup on a provably empty local map", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const read = () => {
         const values = new Map();
         return values.get("missing")!.x;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let a conditional map population prove a later lookup", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const read = (flag, key) => {
         const values = new Map();
         if (flag) values.set(key, { x: 1 });
         return values.get(key)!.x;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat the missing-key branch of has as a presence proof", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const read = (key) => {
         const values = new Map();
         if (!values.has(key)) return values.get(key)!.x;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let unrelated projection membership prove a find result", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const ids = rows.map(row => row.id);
       if (ids.includes(other)) return rows.find(row => row.id === target)!.name;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a false some branch as proof of a find result", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `if (rows.some(row => row.ok) === false) return rows.find(row => row.ok)!.x;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat a false regex test branch as proof of a match result", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `if (regex.test(value) === false) return value.match(regex)![0].trim();`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag get! keyed by the local map's own keys() iteration", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const sectionSizes = (rows: Row[]) => {
        const groups = new Map<string, Row[]>();
        for (const row of rows) groups.set(row.section, [row]);
        return Array.from(groups.keys()).sort().map((section) => groups.get(section)!.length);
      };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags find! over a const array literal when coverage is not proven", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const BREAKPOINT_MAPPING: [Breakpoint, number][] = [
        ['xl', 1840],
        ['l', 1320],
        ['default', -1],
      ];
      export function getBreakpointValue(breakpoint: Breakpoint): number {
        return BREAKPOINT_MAPPING.find(bp => bp[0] === breakpoint)![1];
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags find! over a let-declared array literal (mutable, not a lookup table)", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `let entries = [['a', 1]];
      const lookup = (key: string) => entries.find((entry) => entry[0] === key)![1];`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags find! after a receiver-length guard that does not prove a predicate match", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `async function swapOrder(id1: string, id2: string) {
        const rows = await selectRows(id1, id2);
        if (rows.length !== 2) throw new Error('NOT_FOUND');
        const order1 = rows.find(r => r.id === id1)!.displayOrder;
        const order2 = rows.find(r => r.id === id2)!.displayOrder;
        return [order1, order2];
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags an equality lookup when a different projection does not prove membership", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const useColumns = (columns, colVisible) => {
        const visibleCols = columns.filter(c => colVisible.has(c.key));
        const startResize = (colIndex) => {
          const colKey = visibleCols[colIndex].key;
          return columns.find(c => c.key === colKey)!.minWidth;
        };
        return startResize;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an imported lookup when a later filter does not dominate it", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { groupOptions } from './config';
      export function DataGrouping({ groups }) {
        return (
          <ul>
            {groups.map(({ property, sorting }) => {
              const groupLabel = \`\${groupOptions.find(o => o.value === property)!.label} (\${sorting})\`;
              return (
                <li key={property}>
                  <GroupEditor options={groupOptions.filter(o => o.value === property)} label={groupLabel} />
                </li>
              );
            })}
          </ul>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an equality-lookup find! when the scope never projects the collection", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const widthFor = (columns, colKey) => columns.find(c => c.key === colKey)!.minWidth;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags match! on a string projection when the pattern can miss", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function formatValue(value: number) {
        if (value < 0.1) return '< 0.1';
        return value.toString().match(/^-?\\d+(?:\\.\\d{0,2})?/)![0];
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag match! with an end-anchored pattern that accepts the empty suffix", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const lastLine = value.match(/[^\\n]*$/)![0];`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag match! re-run after a boolean-coerced predicate match with the same regex (findUpUntil shape)", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const contextMatch = /awsui-context-([\\w-]+)/;
      function useVisualContext(elementRef) {
        useLayoutEffect(() => {
          if (elementRef.current) {
            const contextParent = findUpUntil(elementRef.current, node => !!node.className.match(contextMatch));
            setValue(contextParent?.className.match(contextMatch)![1] ?? '');
          }
        }, [elementRef]);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an anchored repeated-character match inside the matching character branch", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function protectedRanges(text: string) {
        let index = 0;
        if (text[index] === "\`") {
          const run = text.slice(index).match(/^\`+/)![0];
          return run;
        }
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an anchored repeated-character match after the guarded index changes", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function protectedRanges(text: string) {
        let index = 0;
        if (text[index] === "\`") {
          index += 1;
          return text.slice(index).match(/^\`+/)![0];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an anchored match when the guarded character does not satisfy the regex", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function protectedRanges(text: string, index: number) {
        if (text[index] === "~") {
          return text.slice(index).match(/^\`+/)![0];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an anchored repeated-character match after an immediate mismatch exit", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function readBacktickRun(text: string, index: number) {
        if (text[index] !== "\`") return null;
        return text.slice(index).match(/^\`+/)![0];
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an anchored match when the receiver is evaluated separately by the guard and match", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function readBacktickRun(index: number) {
        if (getText()[index] === "\`") {
          return getText().slice(index).match(/^\`+/)![0];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an anchored match when slice has an end argument", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function readBacktickRun(text: string, index: number) {
        if (text[index] === "\`") {
          return text.slice(index, index).match(/^\`+/)![0];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an anchored match through a repeatable member getter", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function readBacktickRun(source: { text: string }, index: number) {
        if (source.text[index] === "\`") {
          return source.text.slice(index).match(/^\`+/)![0];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an anchored match after an earlier declarator mutates the index", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function readBacktickRun(text: string, index: number) {
        if (text[index] === "\`") {
          const ignored = index++, run = text.slice(index).match(/^\`+/)![0];
          return run;
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an anchored match after a same-expression index mutation", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function readBacktickRun(text: string, index: number) {
        if (text[index] === "\`") {
          return (index++, text.slice(index).match(/^\`+/)![0]);
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a match proven by the local predicate passed to imported findUpUntil", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/;
      function hasVisualContextClass(node: Element) {
        return typeof node.className === 'string' && !!node.className.match(contextMatch);
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        if (contextParent && typeof contextParent.className === 'string') {
          return contextParent.className.match(contextMatch)![1] ?? '';
        }
        return '';
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a match after a same-shaped local finder with unknown semantics", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `const contextMatch = /awsui-context-([\\w-]+)/;
      function findUpUntil(node, predicate) { return node.parentElement; }
      function hasVisualContextClass(node: Element) {
        return typeof node.className === 'string' && !!node.className.match(contextMatch);
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        return contextParent.className.match(contextMatch)![1];
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a match when the findUpUntil predicate validates a different regex", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/;
      const otherMatch = /awsui-other-([\\w-]+)/;
      function hasVisualContextClass(node: Element) {
        return !!node.className.match(otherMatch);
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        return contextParent.className.match(contextMatch)![1];
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a findUpUntil result mutated before the asserted match", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/;
      function hasVisualContextClass(node: Element) {
        return !!node.className.match(contextMatch);
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        contextParent.className = 'unrelated';
        return contextParent.className.match(contextMatch)![1];
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags findUpUntil when the predicate shadows the asserted regex binding", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/;
      function hasVisualContextClass(node: Element, contextMatch = /unrelated/) {
        return !!node.className.match(contextMatch);
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        if (contextParent) {
          return contextParent.className.match(contextMatch)![1];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags findUpUntil when the predicate can succeed without the regex match", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/;
      function hasVisualContextClass(node: Element) {
        return !!node.className.match(contextMatch) || true;
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        if (contextParent) {
          return contextParent.className.match(contextMatch)![1];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags findUpUntil when a later predicate conjunct mutates the matched property", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/;
      function hasVisualContextClass(node: Element) {
        return !!node.className.match(contextMatch) && ((node.className = 'unrelated'), true);
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        if (contextParent) {
          return contextParent.className.match(contextMatch)![1];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags findUpUntil when the result guard can mutate the matched property", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/;
      function hasVisualContextClass(node: Element) {
        return !!node.className.match(contextMatch);
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        if (contextParent && mutate(contextParent)) {
          return contextParent.className.match(contextMatch)![1];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a shadowed findUpUntil call despite a module import with the same name", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/;
      function hasVisualContextClass(node: Element) {
        return !!node.className.match(contextMatch);
      }
      function detectVisualContext(node: HTMLElement, findUpUntil: Function) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        if (contextParent && typeof contextParent.className === 'string') {
          return contextParent.className.match(contextMatch)![1];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags findUpUntil when the shared regex is sticky", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/y;
      function hasVisualContextClass(node: Element) {
        return !!node.className.match(contextMatch);
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        if (contextParent && typeof contextParent.className === 'string') {
          return contextParent.className.match(contextMatch)![1];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags findUpUntil when the assertion expression mutates the matched property first", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/;
      function hasVisualContextClass(node: Element) {
        return !!node.className.match(contextMatch);
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        if (contextParent && typeof contextParent.className === 'string') {
          return (contextParent.className = 'unrelated', contextParent.className.match(contextMatch)![1]);
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags findUpUntil when another result declarator mutates the matched property", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/;
      function hasVisualContextClass(node: Element) {
        return !!node.className.match(contextMatch);
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass), ignored = (contextParent.className = 'unrelated');
        if (contextParent && typeof contextParent.className === 'string') {
          return contextParent.className.match(contextMatch)![1];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags findUpUntil when its predicate is async", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/;
      async function hasVisualContextClass(node: Element) {
        return !!node.className.match(contextMatch);
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        if (contextParent && typeof contextParent.className === 'string') {
          return contextParent.className.match(contextMatch)![1];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags findUpUntil when another predicate return can succeed without a match", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `import { findUpUntil } from '@cloudscape-design/component-toolkit/dom';
      const contextMatch = /awsui-context-([\\w-]+)/;
      function hasVisualContextClass(node: Element) {
        if (fallback) return true;
        return typeof node.className === 'string' && !!node.className.match(contextMatch);
      }
      function detectVisualContext(node: HTMLElement) {
        const contextParent = findUpUntil(node, hasVisualContextClass);
        if (contextParent && typeof contextParent.className === 'string') {
          return contextParent.className.match(contextMatch)![1];
        }
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag find! guarded by findIndex !== -1 with the identical predicate", () => {
    const result = runRule(
      noNonNullAssertionOnMaybeUndefinedResult,
      `function pick(tabs: Tab[], id: string) {
        if (tabs.findIndex((tab) => tab.id === id) !== -1) {
          return tabs.find((tab) => tab.id === id)!.label;
        }
        return null;
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
