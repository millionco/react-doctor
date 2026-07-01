import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { anchorHasContent } from "./anchor-has-content.js";

describe("a11y/anchor-has-content regressions", () => {
  it("exempts an `<a>` named via `aria-labelledby`", () => {
    const result = runRule(
      anchorHasContent,
      `const A = () => <a href="/p" aria-labelledby="lbl" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an `<a>` with no content or accessible name", () => {
    const result = runRule(anchorHasContent, `const A = () => <a href="/p" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  // An `<a {...props} />` can receive its children at runtime, so it can't
  // be proven empty and must not be flagged.
  it("exempts an `<a>` that spreads props", () => {
    const result = runRule(anchorHasContent, `const A = (props) => <a href="/p" {...props} />;`);
    expect(result.diagnostics).toEqual([]);
  });
});
