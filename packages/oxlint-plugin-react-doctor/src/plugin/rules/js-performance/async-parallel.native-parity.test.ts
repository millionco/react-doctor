import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { asyncParallel } from "./async-parallel.js";

describe("async parallel native serialization parity", () => {
  it.each([
    { expression: "import('./resource')", binding: "", expectedCount: 0 },
    { expression: "import('./resource')", binding: "const third = ", expectedCount: 1 },
    { expression: "new Request('/resource')", binding: "", expectedCount: 0 },
    { expression: "new Request('/resource')", binding: "const third = ", expectedCount: 1 },
  ])("preserves $binding await $expression", ({ expression, binding, expectedCount }) => {
    const result = runRule(
      asyncParallel,
      `export async function load() {
          const first = await ${expression};
          const second = await ${expression};
          ${binding}await ${expression};
          return [first, second];
        }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
