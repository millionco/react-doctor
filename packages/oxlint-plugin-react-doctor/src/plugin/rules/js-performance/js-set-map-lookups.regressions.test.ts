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
      `function f(users, roles){ const a=[]; for(const u of users){ if(roles.includes(u.role)) a.push(u);} return a; }`,
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
      `function f(candidates, allowedValues){ const out=[]; for(const candidate of candidates){ if(allowedValues.indexOf(candidate) !== -1) out.push(candidate); } return out; } f([NaN, 2], [NaN, 2]);`,
    );
  });

  it("does not flag `.indexOf() >= 0` membership tests in a loop", () => {
    expectPass(
      `function f(users, roles){ const out=[]; for(const u of users){ if(roles.indexOf(u.role) >= 0) out.push(u); } return out; }`,
    );
  });

  it("does not flag `~.indexOf()` membership tests in a loop", () => {
    expectPass(
      `function f(users, roles){ const out=[]; for(const u of users){ if(~roles.indexOf(u.role)) out.push(u); } return out; }`,
    );
  });

  it("does not flag `.includes()` with a fromIndex argument", () => {
    expectPass(
      `function f(users, roles){ const out=[]; for(const u of users){ if(roles.includes(u.role, 1)) out.push(u); } return out; }`,
    );
  });

  it.each([
    `function f(users, roles){ for(const user of users){ roles.includes(user.role, 0); } }`,
    `function f(users, roles){ for(const user of users){ roles.includes(user.role, -1); } }`,
    `function f(users, roles){ for(const user of users){ roles.includes(user.role, undefined); } }`,
    `function f(users, roles, fromIndex){ for(const user of users){ roles.includes(user.role, fromIndex); } }`,
    `function f(users, roles, args){ for(const user of users){ roles.includes(...args); } }`,
  ])("does not flag a lookup that can supply a fromIndex", (code) => {
    expectPass(code);
  });

  it.each([
    `function f(users, roles){ for(const user of users){ roles?.includes(user.role); } }`,
    `function f(users, roles){ for(const user of users){ roles.includes?.(user.role); } }`,
    `function f(users, roles){ for(const user of users){ roles["includes"](user.role); } }`,
  ])("does not flag optional or computed method access", (code) => {
    expectPass(code);
  });

  it.each([
    `interface Bag { includes(value: number): boolean } function f(values: Bag, candidates: number[]){ for(const candidate of candidates){ values.includes(candidate); } }`,
    `function f(values: { includes(value: number): boolean }, candidates: number[]){ for(const candidate of candidates){ values.includes(candidate); } }`,
    `function f(candidates){ const values = { includes(value){ return value > 0; } }; for(const candidate of candidates){ values.includes(candidate); } }`,
    `class Bag { includes(value){ return value > 0; } } function f(candidates){ const values = new Bag(); for(const candidate of candidates){ values.includes(candidate); } }`,
    `function makeBag(){ return { includes(value){ return value > 0; } }; } function f(candidates){ for(const candidate of candidates){ makeBag().includes(candidate); } }`,
    `function f(candidates, collection){ for(const candidate of candidates){ collection.map(candidate).includes(candidate); } }`,
    `function f(candidates){ const source = { includes(value){ return value > 0; } }; const firstAlias = source; const values = firstAlias; for(const candidate of candidates){ values.includes(candidate); } }`,
    `function f(candidates){ const Array = class { includes(value){ return value > 0; } }; const values = new Array(); for(const candidate of candidates){ values.includes(candidate); } }`,
    `interface Bag { includes(value: number): boolean } function f(state: { values: Bag }, candidates: number[]){ for(const candidate of candidates){ state.values.includes(candidate); } }`,
    `interface Bag { includes(value: number): boolean } interface State { values: Bag } function f(state: State, candidates: number[]){ for(const candidate of candidates){ state.values.includes(candidate); } }`,
    `interface Bag { includes(value: number): boolean } type State = { values: Bag }; function f(state: State, candidates: number[]){ for(const candidate of candidates){ state["values"].includes(candidate); } }`,
    `interface Bag { includes(value: number): boolean } class Example { values: Bag; f(candidates: number[]){ for(const candidate of candidates){ this.values.includes(candidate); } } }`,
    `interface Bag { includes(value: number): boolean } class Example { values: Bag; f(candidates: number[]){ for(const candidate of candidates){ this["values"].includes(candidate); } } }`,
    `function f(state, candidates, propertyName){ for(const candidate of candidates){ state[propertyName].includes(candidate); } }`,
  ])("does not flag a proven userland includes receiver", (code) => {
    expectPass(code);
  });

  it.each([
    `function f(candidates: number[], values: number[]){ for(const candidate of candidates){ values.filter(Boolean).includes(candidate); } }`,
    `function f(candidates: number[], values: number[]){ for(const candidate of candidates){ values.slice().includes(candidate); } }`,
    `function f(candidates: number[]){ for(const candidate of candidates){ new Uint8Array(20).includes(candidate); } }`,
  ])("does not flag a collection rebuilt for each lookup", (code) => {
    expectPass(code);
  });

  it.each([
    `function f(values: string, candidates: string[]){ for(const candidate of candidates){ values.includes(candidate); } }`,
    `function f(source: string, candidates: string[]){ const values = source; for(const candidate of candidates){ values.includes(candidate); } }`,
    `function f(source: String, candidates: string[]){ for(const candidate of candidates){ source.includes(candidate); } }`,
    `function f(candidates){ const values = new String("abc"); for(const candidate of candidates){ values.includes(candidate); } }`,
  ])("does not flag a string receiver regardless of its name", (code) => {
    expectPass(code);
  });

  it.each([
    `function f(candidates: number[], allowedValues: readonly number[]){ for(const candidate of candidates){ allowedValues.includes(candidate); } }`,
    `function f(candidates: number[], allowedValues: readonly number[]){ const values = allowedValues; for(const candidate of candidates){ values.includes(candidate); } }`,
    `function f(candidates: number[], allowedValues: readonly number[]){ for(const candidate of candidates){ (allowedValues as readonly number[]).includes(candidate); } }`,
    `function f(candidates: number[], allowedValues: readonly number[]){ for(const candidate of candidates){ allowedValues!.includes(candidate); } }`,
    `function f(candidates: number[], allowedValues: Uint8Array){ for(const candidate of candidates){ allowedValues.includes(candidate); } }`,
    `function f(candidates: number[]){ const allowedValues = Array(20); for(const candidate of candidates){ allowedValues.includes(candidate); } }`,
  ])("flags a one-argument SameValueZero lookup on a native receiver", (code) => {
    expectFail(code);
  });

  it("flags NaN and sparse-hole lookups because Set preserves includes semantics", () => {
    expectFail(
      `function f(candidates: number[], allowedValues: readonly number[]){ const sparseValues = Array(20); for(const candidate of candidates){ allowedValues.includes(NaN); sparseValues.includes(undefined); } }`,
    );
  });

  it.each([
    `function f(values: number[], candidates: number[]){ for(const candidate of candidates){ values.push(candidate); values.includes(candidate); } }`,
    `function f(values: number[], candidates: number[]){ for(const candidate of candidates){ values[0] = candidate; values.includes(candidate); } }`,
    `function f(values: number[], candidates: number[]){ const alias = values; for(const candidate of candidates){ alias.splice(0, 1); values.includes(candidate); } }`,
    `function f(values: number[], candidates: number[]){ const firstAlias = values; const secondAlias = firstAlias; for(const candidate of candidates){ secondAlias.splice(0, 1); values.includes(candidate); } }`,
    `function f(values: number[], candidates: number[]){ const firstAlias = values; const secondAlias = firstAlias; for(const candidate of candidates){ firstAlias[0] = candidate; secondAlias.includes(candidate); } }`,
    `function f(values: number[], candidates: number[]){ const alias = values; for(const candidate of candidates){ alias.length = 0; values.includes(candidate); } }`,
    `function f(values: number[], candidates: number[]){ const firstAlias = values; const secondAlias = firstAlias; for(const candidate of candidates){ values.push(candidate); secondAlias.includes(candidate); } }`,
    `function f(values: number[], candidates: number[]){ for(const candidate of candidates){ delete values[0]; values.includes(candidate); } }`,
    `function f(values: number[], candidates: number[]){ for(const candidate of candidates){ Object.assign(values, { 0: candidate }); values.includes(candidate); } }`,
    `function f(values: number[], candidates: number[]){ for(const candidate of candidates){ Reflect.set(values, 0, candidate); values.includes(candidate); } }`,
    `interface State { values: number[] } function f(state: State, candidates: number[]){ for(const candidate of candidates){ state.values.reverse(); state.values.includes(candidate); } }`,
    `interface State { values: number[] } function f(state: State, candidates: number[]){ const alias = state; for(const candidate of candidates){ alias.values.push(candidate); state.values.includes(candidate); } }`,
  ])("does not flag a receiver mutated during repeated lookups", (code) => {
    expectPass(code);
  });

  it("does not flag a member whose imported type cannot prove native array semantics", () => {
    expectPass(
      `import type { State } from "./types"; function f(state: State, candidates: number[]){ for(const candidate of candidates){ state.values.includes(candidate); } }`,
    );
  });

  it("does not treat an imported userland type aliased as Array as native", () => {
    expectPass(
      `import type { Bag as Array } from "./types"; function f(values: Array<number>, candidates: number[]){ for(const candidate of candidates){ values.includes(candidate); } }`,
    );
  });

  it("still recognizes the unshadowed built-in Array type", () => {
    expectFail(
      `function f(values: Array<number>, candidates: number[]){ for(const candidate of candidates){ values.includes(candidate); } }`,
    );
  });

  it.each([
    `function f(candidates: readonly number[], allowedValues: readonly number[]){ for(const candidate of candidates){ allowedValues.includes(-0); } }`,
    `function f(candidates: readonly object[], allowedValues: readonly object[]){ for(const candidate of candidates){ allowedValues.includes(candidate); } }`,
    `function f(candidates: readonly (string | boolean | bigint | undefined)[], allowedValues: readonly (string | boolean | bigint | undefined)[]){ for(const candidate of candidates){ allowedValues.includes(candidate); } }`,
  ])("flags native includes where Set preserves the equality relation", (code) => {
    expectFail(code);
  });

  it("does not flag `.indexOf()` assigned as an index position in a loop", () => {
    expectPass(
      `function f(rows, order){ for (const row of rows){ const position = order.indexOf(row.id); row.rank = position; } }`,
    );
  });

  it("flags `.includes()` inside a `.filter()` iteration callback", () => {
    expectFail(
      `function f(tokens, capturedTokenIndices){ return tokens.filter((token, index) => !capturedTokenIndices.includes(index)); }`,
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
      `function f(rows, options: { weekendDays?: number[] }) { const days = options.weekendDays ?? [0, 6]; for (const row of rows) { if (days.includes(row.day)) row.weekend = true; } }`,
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

  it("does not flag a dynamically indexed receiver without element-type proof", () => {
    expectPass(
      `function f(groups, ids, bucket){ return ids.filter((id) => groups[bucket].includes(id)); }`,
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
      `function f(rows, enabled){ return rows.map((row) => AGENT_OPTIONS.map((option) => enabled.includes(row.id + option))); }`,
    );
  });

  it("still flags a lookup inside a map over unbounded data", () => {
    expectFail(
      `function f(items, allowlist){ return items.map((item) => allowlist.includes(item.id)); }`,
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
      `function f(elements: readonly unknown[], groups: readonly (readonly unknown[])[]) {
        const types = groups.flat();
        return elements.filter((element) => types.includes(element.type));
      }`,
    );
  });
});
