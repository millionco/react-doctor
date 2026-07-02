import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsTosortedImmutable } from "./js-tosorted-immutable.js";

const expectFail = (code: string): void => {
  const result = runRule(jsTosortedImmutable, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(jsTosortedImmutable, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/js-tosorted-immutable — regressions", () => {
  it("flags `[...arr].sort()` on a reused array binding", () => {
    expectFail(`const arr = getItems();\nconst s = [...arr].sort();`);
  });

  it("flags `[...props.items].sort()` on a member-expression receiver", () => {
    expectFail(`const s = [...props.items].sort();`);
  });

  it("does not flag spreading a freshly constructed `new Set(...)`", () => {
    expectPass(`const s = [...new Set(ids)].sort();`);
  });

  it("does not flag spreading an iterator (`map.values()`)", () => {
    expectPass(`const s = [...map.values()].sort();`);
  });

  it("flags an array-literal binding that is referenced elsewhere", () => {
    expectFail(`const arr = [3, 1, 2];\nrender(arr);\nconst s = [...arr].sort();\nrender(arr);`);
  });

  it("flags a parameter with an array-literal default (caller-supplied array)", () => {
    expectFail(`const sortItems = (items = []) => [...items].sort();`);
  });

  it("flags a `let` binding reassigned after a fresh init", () => {
    expectFail(`let arr = [];\narr = fetchRows();\nconst s = [...arr].sort();`);
  });

  it("flags a filter-result binding that is referenced elsewhere", () => {
    expectFail(
      `const visible = rows.filter(isVisible);\nrender(visible);\nconst s = [...visible].sort();`,
    );
  });

  it("does not flag a single-use fresh filter-result binding", () => {
    expectPass(`export const sortShown = (items) => {
      const shown = items.filter((item) => !item.hidden);
      return [...shown].sort((first, second) => first.id.localeCompare(second.id));
    };`);
  });

  // Accepted heuristic tradeoff: a direct call expression whose method NAME
  // matches the fresh-array allowlist is exempt regardless of receiver.
  it("does not flag a direct name-only fresh-array method call receiver", () => {
    expectPass(`const s = [...registry.from(key)].sort();`);
  });
});
