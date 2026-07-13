import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsSetMapLookups } from "./js-set-map-lookups.js";

const expectFail = (code: string): void => {
  const result = runRule(jsSetMapLookups, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsSetMapLookups, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-set-map-lookups — regressions", () => {
  it("flags `.includes()` against a named array inside a loop", () => {
    expectFail(
      `function f(users, roles: string[]){ const a=[]; for(const u of users){ if(roles.includes(u.role)) a.push(u);} return a; }`,
    );
  });

  it("does not flag `.includes()` against a small inline literal array", () => {
    expectPass(
      `function f(users){ const a=[]; for(const u of users){ if(["admin","owner"].includes(u.role)) a.push(u);} return a; }`,
    );
  });

  it("does not flag `.includes()` on a `.join()` result (substring search)", () => {
    expectPass(
      `function f(items, parts){ for (const item of items){ if (parts.join("/").includes("..")){ use(item); } } }`,
    );
  });

  it("flags `.includes()` against a 9-element inline literal array (over threshold)", () => {
    expectFail(
      `function f(users){ const out=[]; for(const u of users){ if(["a","b","c","d","e","f","g","h","i"].includes(u.role)) out.push(u); } return out; }`,
    );
  });

  it("flags `.includes()` against an inline array with spread", () => {
    expectFail(
      `function f(users, extra){ const out=[]; for(const u of users){ if(["a", ...extra].includes(u.role)) out.push(u); } return out; }`,
    );
  });

  it("does not flag an array variable named `key` (documents name-based FN)", () => {
    expectPass(
      `function f(items, key){ const out=[]; for(const item of items){ if(key.includes(item.id)) out.push(item); } return out; }`,
    );
  });

  it("does not flag destructured `pathname.includes(matchPath)` in a for loop (ant-design 404 page)", () => {
    expectPass(
      `function NotFound(pathname, DIRECT_MAP, router){ const directLinks = Object.keys(DIRECT_MAP); for (let i = 0; i < directLinks.length; i += 1) { const matchPath = directLinks[i]; if (pathname.includes(matchPath)) { router.replace(matchPath); } } }`,
    );
  });

  it("does not flag `.includes('{')` with a single-character literal (ant-design semantic-md)", () => {
    expectPass(
      `function parseTemplateUsage(content, importRegex){ const results = []; for (const match of content.matchAll(importRegex)) { const importClause = match[1].trim(); if (importClause.startsWith('{')) { results.push(1); } else if (importClause.includes('{')) { results.push(2); } } return results; }`,
    );
  });

  it("does not flag `.indexOf()` used as a position (ant-design usePositions index-of-minimum)", () => {
    expectPass(
      `function layout(itemHeights, columnCount, verticalGutter){ const columnHeights = new Array(columnCount).fill(0); for (let i = 0; i < itemHeights.length; i += 1) { const [itemKey, itemHeight, itemColumn] = itemHeights[i]; let targetColumnIndex = itemColumn ?? columnHeights.indexOf(Math.min(...columnHeights)); columnHeights[targetColumnIndex] += itemHeight + verticalGutter; } return columnHeights; }`,
    );
  });

  it("does not flag `.indexOf() !== -1` membership when values can include NaN", () => {
    expectPass(
      `function f(candidates: number[], allowedValues: number[]){ const out=[]; for(const candidate of candidates){ if(allowedValues.indexOf(candidate) !== -1) out.push(candidate); } return out; }`,
    );
  });

  it("flags `.indexOf() >= 0` for string membership in a loop", () => {
    expectFail(
      `function f(users: string[], roles: string[]){ const out=[]; for(const user of users){ if(roles.indexOf(user) >= 0) out.push(user); } return out; }`,
    );
  });

  it("flags `~.indexOf()` for object identity membership in a loop", () => {
    expectFail(
      `function f(users: object[], selected: object[]){ const out=[]; for(const user of users){ if(~selected.indexOf(user)) out.push(user); } return out; }`,
    );
  });

  it.each([
    "0",
    "-0",
    "0.5",
    "-0.5",
    '"0.5"',
    '"not a number"',
    "undefined",
    "null",
    "false",
    '""',
    "NaN",
    "Number.NaN",
  ])("flags `.includes()` with a semantics-preserving %s fromIndex", (fromIndex) => {
    expectFail(
      `function f(users, roles: string[]){ const out=[]; for(const user of users){ if(roles.includes(user.role, ${fromIndex})) out.push(user); } return out; }`,
    );
  });

  it.each(["1", "-1", "1.1", '"1.1"', "true", "start"])(
    "does not flag `.includes()` with a semantics-changing %s fromIndex",
    (fromIndex) => {
      expectPass(
        `function f(users, roles, start){ const out=[]; for(const user of users){ if(roles.includes(user.role, ${fromIndex})) out.push(user); } return out; }`,
      );
    },
  );

  it("does not flag `.includes()` with spread arguments", () => {
    expectPass(
      `function f(users, roles, args){ const out=[]; for(const user of users){ if(roles.includes(...args)) out.push(user); } return out; }`,
    );
  });

  it("does not flag Lodash `includes` inside a Lodash iteration callback", () => {
    expectPass(
      `function f(_, tiles, nestedBoardIds){ _.forEach(tiles, (tile) => { if (!_.includes(nestedBoardIds, tile.id)) nestedBoardIds.push(tile.id); }); }`,
    );
  });

  it.each(["0", "null", "NaN"])(
    "does not treat a userland two-argument `includes` call with %s as native Array membership",
    (secondArgument) => {
      expectPass(
        `function f(rows, RangeApi){ for (const row of rows){ if(RangeApi.includes(row.range, ${secondArgument})) return row; } }`,
      );
    },
  );

  it("flags a zero-fromIndex lookup on an array-literal binding", () => {
    expectFail(
      `function f(rows){ const roles = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"]; for (const row of rows){ if(roles.includes(row.role, 0)) return row; } }`,
    );
  });

  it("does not treat a shadowed undefined fromIndex as zero", () => {
    expectPass(
      `function f(users, roles, undefined){ const out=[]; for(const user of users){ if(roles.includes(user.role, undefined)) out.push(user); } return out; }`,
    );
  });

  it.each([
    "function f(users, roles, NaN){ for (const user of users){ if(roles.includes(user.role, NaN)) return user; } }",
    "function f(users, roles, Number){ for (const user of users){ if(roles.includes(user.role, Number.NaN)) return user; } }",
  ])("does not treat shadowed NaN values as a zero fromIndex", (code) => {
    expectPass(code);
  });

  it("flags `.indexOf()` with a native iteration index", () => {
    expectFail(
      `function f(tokens, selectedIndices: number[]){ return tokens.filter((token, index) => selectedIndices.indexOf(index) !== -1); }`,
    );
  });

  it("does not flag `.indexOf(undefined)` because sparse holes become undefined in a Set", () => {
    expectPass(
      `function f(rows, allowedValues: Array<number | undefined>){ for (const row of rows){ if(allowedValues.indexOf(undefined) !== -1) return row; } }`,
    );
  });

  it("flags `.indexOf(undefined)` on a proven dense array", () => {
    expectFail(
      `function f(rows){ const allowedValues = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]; for (const row of rows){ if(allowedValues.indexOf(undefined) !== -1) return row; } }`,
    );
  });

  it("does not flag `.indexOf()` on an unconstrained generic array", () => {
    expectPass(`
      interface Option<T> { datum: T }
      interface Props<T> { selected?: ReadonlyArray<T>; options: ReadonlyArray<Option<T>> }
      function f<T>({ selected, options }: Props<T>) {
        return options.filter((option) => selected?.indexOf(option.datum) !== -1);
      }
    `);
  });

  it("flags `.indexOf()` on an object-constrained generic array", () => {
    expectFail(`
      interface Option<T> { datum: T }
      interface Props<T> { selected?: ReadonlyArray<T>; options: ReadonlyArray<Option<T>> }
      function f<T extends object>({ selected, options }: Props<T>) {
        return options.filter((option) => selected?.indexOf(option.datum) !== -1);
      }
    `);
  });

  it.each(["{}", "NonNullable<unknown>", "PropertyKey"])(
    "does not flag `.indexOf()` on a generic constrained to the broad %s domain",
    (constraint) => {
      expectPass(`
        function f<T extends ${constraint}>(candidates: readonly T[], allowedValues: readonly T[]) {
          return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
        }
      `);
    },
  );

  it("does not flag `.indexOf()` through an unresolved imported element domain", () => {
    expectPass(`
      import type { Numeric } from "./types";
      function f(candidates: Numeric[], allowedValues: Numeric[]) {
        return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
      }
    `);
  });

  it.each(["Number(candidate)", "parseFloat(candidate)", "candidate / total"])(
    "does not flag an untyped `.indexOf()` query that can evaluate to NaN: %s",
    (query) => {
      expectPass(`
        function f(candidates, total) {
          const allowedValues = [1, 2, 3, 4, 5, 6, 7, 8, 9];
          return candidates.filter((candidate) => allowedValues.indexOf(${query}) !== -1);
        }
      `);
    },
  );

  it.each(["number", "number | string"])(
    "does not flag `.indexOf()` on a generic array constrained to %s",
    (constraint) => {
      expectPass(`
        function f<T extends ${constraint}>(candidates: readonly T[], allowedValues: readonly T[]) {
          return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
        }
      `);
    },
  );

  it("flags `.indexOf()` on a finite-literal-constrained generic array", () => {
    expectFail(`
      function f<T extends 1 | 2>(candidates: readonly T[], allowedValues: readonly T[]) {
        return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
      }
    `);
  });

  it.each([
    "type Numeric = number; function f<T extends Numeric>(candidates: T[], allowedValues: T[])",
    "function f<Domain extends number, T extends Domain>(candidates: T[], allowedValues: T[])",
  ])("does not flag `.indexOf()` through nested numeric constraints", (declaration) => {
    expectPass(`
      ${declaration} {
        return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
      }
    `);
  });

  it.each([
    "type Finite = 1 | 2; function f(candidates: Finite[], allowedValues: Finite[])",
    "function f(candidates: Array<1 | 2>, allowedValues: readonly [1, 2])",
  ])("flags `.indexOf()` through finite literal aliases and tuples", (declaration) => {
    expectFail(`
      ${declaration} {
        return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
      }
    `);
  });

  it.each([
    "allowedValues: [number, number]",
    "allowedValues: readonly [number, number]",
    "allowedValues: [first?: number]",
    "allowedValues: [string, ...number[]]",
    "allowedValues: NumericValues",
    "allowedValues: readonly Numeric[]",
    "allowedValues: GenericValues<number>",
  ])("does not flag `.indexOf()` for numeric tuple or alias domain: %s", (parameter) => {
    expectPass(`
      type Numeric = number;
      type NumericValues = [Numeric, Numeric];
      type GenericValues<Value> = readonly [Value, Value];
      function f(candidates: number[], ${parameter}) {
        return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
      }
    `);
  });

  it("flags `.indexOf()` through a finite generic tuple alias", () => {
    expectFail(`
      type GenericValues<Value> = readonly [Value, Value];
      function f(candidates: Array<1 | 2>, allowedValues: GenericValues<1 | 2>) {
        return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
      }
    `);
  });

  it("flags `.indexOf()` through a same-file string array alias", () => {
    expectFail(`
      type TextValues = readonly string[];
      function f(candidates: string[], allowedValues: TextValues) {
        return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
      }
    `);
  });

  it("does not flag one-argument userland `.includes()`", () => {
    expectPass(`
      interface Matcher { includes(value: string): boolean }
      function f(candidates: string[], matcher: Matcher) {
        return candidates.filter((candidate) => matcher.includes(candidate));
      }
    `);
  });

  it("does not flag one-argument userland `.indexOf()`", () => {
    expectPass(`
      interface Matcher { indexOf(value: string): number }
      function f(candidates: string[], matcher: Matcher) {
        return candidates.filter((candidate) => matcher.indexOf(candidate) !== -1);
      }
    `);
  });

  it.each(["includes(candidate)", "indexOf(candidate) !== -1"])(
    "flags a one-argument native array membership test: %s",
    (membershipTest) => {
      expectFail(`
        function f(candidates: string[], allowedValues: readonly string[]) {
          return candidates.filter((candidate) => allowedValues.${membershipTest});
        }
      `);
    },
  );

  it("does not flag `.indexOf()` on a destructured numeric tuple alias", () => {
    expectPass(`
      type NumericPair = readonly [number, number];
      interface Props { allowedValues: NumericPair; candidates: number[] }
      function f({ allowedValues, candidates }: Props) {
        return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
      }
    `);
  });

  it.each(["readonly [string, string]", "[first?: string]", "readonly undefined[]"])(
    "flags `.indexOf()` for a SameValueZero-safe %s domain",
    (allowedValuesType) => {
      expectFail(`
        function f(candidates, allowedValues: ${allowedValuesType}) {
          return candidates.filter((candidate) => allowedValues.indexOf(candidate) !== -1);
        }
      `);
    },
  );

  it("does not flag `.indexOf()` assigned as an index position in a loop", () => {
    expectPass(
      `function f(rows, order){ for (const row of rows){ const position = order.indexOf(row.id); row.rank = position; } }`,
    );
  });

  it("flags `.includes()` inside a `.filter()` iteration callback", () => {
    expectFail(
      `function f(tokens, capturedTokenIndices: number[]){ return tokens.filter((token, index) => !capturedTokenIndices.includes(index)); }`,
    );
  });

  it("does not flag a receiver resolved to a small literal array through a binding", () => {
    expectPass(
      `function f(rows){ const kinds = ["read", "write", "edit"]; for (const row of rows){ if (kinds.includes(row.kind)) row.ok = true; } }`,
    );
  });

  it.each([
    `function f(rows, { weekendDays = [0, 6] }: { weekendDays?: number[] }) { for (const row of rows) { if (weekendDays.includes(row.day)) row.weekend = true; } }`,
    `function f(rows, { weekendDays = [0, 6] }: { weekendDays?: readonly number[] }) { for (const row of rows) { if (weekendDays.includes(row.day)) row.weekend = true; } }`,
    `function f(rows, weekendDays: number[] = [0, 6]) { for (const row of rows) { if (weekendDays.includes(row.day)) row.weekend = true; } }`,
  ])("flags a caller-controlled array with a small fallback", (code) => {
    expectFail(code);
  });

  it("flags a caller-controlled alias with a small fallback", () => {
    expectFail(
      `function f(rows, { weekendDays = [0, 6] }: { weekendDays?: number[] }) { const days = weekendDays; for (const row of rows) { if (days.includes(row.day)) row.weekend = true; } }`,
    );
  });

  it("flags a caller-controlled nullish fallback", () => {
    expectFail(
      `function f(rows, options: { weekendDays?: number[] }) { const days: number[] = options.weekendDays ?? [0, 6]; for (const row of rows) { if (days.includes(row.day)) row.weekend = true; } }`,
    );
  });

  it("does not flag a SCREAMING_SNAKE_CASE constant receiver", () => {
    expectPass(
      `import { VALID_PAGE_TYPES } from "./types"; function f(entries){ for (const entry of entries){ if (VALID_PAGE_TYPES.includes(entry.pageType)) entry.ok = true; } }`,
    );
  });

  it("does not flag a SCREAMING_SNAKE_CASE constant behind an `as` cast", () => {
    expectPass(
      `import { VALID_PAGE_TYPES } from "./types"; function f(entries){ for (const entry of entries){ if ((VALID_PAGE_TYPES as string[]).includes(entry.pageType)) entry.ok = true; } }`,
    );
  });

  it("does not flag a per-iteration array bound by a destructured for-of", () => {
    expectPass(
      `function f(dbMappings, viewId){ for (const [databaseId, viewIds] of Object.entries(dbMappings)){ if (viewIds.includes(viewId)) return databaseId; } }`,
    );
  });

  it("does not flag a per-item member array inside an iteration callback", () => {
    expectPass(
      `function f(columns, groupId){ return columns.filter((column) => column.parentGroupIds.includes(groupId)); }`,
    );
  });

  it("does not flag a string-array element receiver like `contentLines[i]`", () => {
    expectPass(
      `function f(contentLines, query){ for (let i = 0; i < contentLines.length; i++){ if (contentLines[i].includes(query)) return i; } }`,
    );
  });

  it("does not flag a punctuated template-literal argument (substring search)", () => {
    expectPass(
      `function f(connections, func){ for (const connection of connections){ if (connection.resource.includes(\`\${func}(\`)) return connection; } }`,
    );
  });

  it("does not flag `.indexOf() === 0` prefix checks", () => {
    expectPass(
      `function f(args, envParam){ for (const nextArgument of args){ if (nextArgument.indexOf(envParam) === 0) return nextArgument; } }`,
    );
  });

  it("does not flag a normalize*() call receiver (string-returning helper)", () => {
    expectPass(
      `function f(sources, needle){ return sources.filter((s) => normalizeForMatch(s.chunkText).includes(needle)); }`,
    );
  });

  it("does not flag a split*() call receiver (array rebuilt per call)", () => {
    expectPass(
      `function f(bindings, key){ for (const binding of bindings){ if (splitHotkeyBinding(binding).includes(key)) return binding; } }`,
    );
  });

  it("does not flag an OUTER-loop per-item receiver inside a nested loop", () => {
    expectPass(
      `function f(allCountries, regions){ return allCountries.filter((country) => regions.map((region) => country.regions.includes(region)).some((el) => el)); }`,
    );
  });

  it("does not flag a constant record indexed by the iteration binding", () => {
    expectPass(
      `function f(backends){ return Object.keys(BACKEND_URLS).find((key) => backends && BACKEND_URLS[key].includes(backends[0])); }`,
    );
  });

  it("still flags a loop-invariant array indexed by an OUTER constant", () => {
    expectFail(
      `function f(groups, ids, bucket){ const allowedValues: string[] = groups[bucket]; return ids.filter((id) => allowedValues.includes(id)); }`,
    );
  });

  // Delta-verify new FP (PortOS AppOverrideRow): the enclosing map iterates
  // AGENT_OPTIONS, a tiny module-constant enum — the lookup runs a fixed
  // handful of times, so a hoisted Set cannot beat the scan.
  it("does not flag a lookup whose only enclosing loop iterates a SCREAMING_SNAKE_CASE constant", () => {
    expectPass(
      `const Row = ({ managedAgentOptions }) => (
        <div>
          {AGENT_OPTIONS.map(({ field, label }) => {
            const managed = managedAgentOptions?.includes(field);
            return <button key={field} disabled={managed}>{label}</button>;
          })}
        </div>
      );`,
    );
  });

  it("does not flag a lookup inside a map over a small resolved constant array literal", () => {
    expectPass(
      `const MODES = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      const f = (enabled) => MODES.map((mode) => enabled.includes(mode.id));`,
    );
  });

  it("still flags when an unbounded outer loop wraps the constant-enum map", () => {
    expectFail(
      `function f(rows, enabled: string[]){ return rows.map((row) => AGENT_OPTIONS.map((option) => enabled.includes(row.id + option))); }`,
    );
  });

  it("still flags a lookup inside a map over unbounded data", () => {
    expectFail(
      `function f(items, allowlist: string[]){ return items.map((item) => allowlist.includes(item.id)); }`,
    );
  });

  // Delta-verify new FP (eBay evo-web filterByType): `[componentType].flat()`
  // is the normalize-to-array idiom — a 1-2 element list probed per child is
  // cheaper than building a Set.
  it("does not flag a receiver resolving to a `.flat()` of a tiny array literal", () => {
    expectPass(
      `export function filterByType(nodes = [], componentType) {
        const elements = Children.toArray(nodes);
        const types = [componentType].flat();
        return elements.filter(({ type }) => types.includes(type));
      }`,
    );
  });

  it("still flags a receiver resolving to a `.flat()` of an unbounded array", () => {
    expectFail(
      `function f(elements, groups) {
        const types: string[] = groups.flat();
        return elements.filter((element) => types.includes(element.type));
      }`,
    );
  });
});
