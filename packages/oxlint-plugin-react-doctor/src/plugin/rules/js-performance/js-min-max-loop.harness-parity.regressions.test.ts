import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsMinMaxLoop } from "./js-min-max-loop.js";

const diagnosticsFor = (code: string) => {
  const result = runRule(jsMinMaxLoop, code);
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics;
};

// PR #994 fp-review: production oxlint never emits ParenthesizedExpression,
// so the canonical numeric comparator written with parens fires at runtime.
// The harness previously kept the wrapper (oxc-parser default preserveParens)
// and masked these shapes; parse-fixture now strips parens to match.
describe("js-performance/js-min-max-loop — parenthesized comparator parity", () => {
  it("flags the concise parenthesized ascending comparator `(a, b) => (a - b)`", () => {
    const diagnostics = diagnosticsFor(`const smallest = [3, 1, 2].sort((a, b) => (a - b))[0];`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Math.min(...array)");
  });

  it("flags the block-body parenthesized comparator `{ return (a - b); }`", () => {
    const diagnostics = diagnosticsFor(
      `const smallest = [3, 1, 2].sort((a, b) => { return (a - b); })[0];`,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Math.min(...array)");
  });

  it("flags the parenthesized descending comparator `(b - a)` with a Math.max hint at [0]", () => {
    const diagnostics = diagnosticsFor(`const largest = [3, 1, 2].sort((a, b) => (b - a))[0];`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toContain("Math.max(...array)");
  });

  it("mined ant-design FP: parenthesized derived-key comparator stays silent", () => {
    expect(
      diagnosticsFor(`const firstMatch = distance.sort((a, b) => (a.dist - b.dist))[0];`),
    ).toHaveLength(0);
  });

  it("mined ant-design FP: parenthesized conditional-expression comparator stays silent", () => {
    expect(
      diagnosticsFor(
        `const link = blogList.sort((a, b) => (a.frontmatter?.date > b.frontmatter?.date ? -1 : 1))[0].link;`,
      ),
    ).toHaveLength(0);
  });
});
