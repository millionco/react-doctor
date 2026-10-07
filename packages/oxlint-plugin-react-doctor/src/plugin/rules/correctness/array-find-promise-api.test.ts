import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayFindResultMemberAccessWithoutGuard } from "./no-array-find-result-member-access-without-guard.js";

describe("promise-returning find APIs", () => {
  it.each(["then", "catch", "finally"])("accepts an unknown query API followed by %s", (method) => {
    const result = runRule(
      noArrayFindResultMemberAccessWithoutGuard,
      `const load = (context, query) => context.api.records.find(query).${method}(handle);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    `const items = []; items.find(predicate).then(handle);`,
    `items.find(item => item.active).then(handle);`,
    `items.find(predicate).name;`,
    `const predicate = item => item.active; items.find(predicate).then(handle);`,
    `function predicate(item) { return item.active; } items.find(predicate).catch(handle);`,
    `items.find(Boolean).finally(handle);`,
  ])("retains array-like unsafe result access", (code) => {
    expect(runRule(noArrayFindResultMemberAccessWithoutGuard, code).diagnostics).toHaveLength(1);
  });
});
