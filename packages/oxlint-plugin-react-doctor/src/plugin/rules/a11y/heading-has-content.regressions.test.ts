import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { headingHasContent } from "./heading-has-content.js";

describe("a11y/heading-has-content regressions", () => {
  it("exempts a heading named via `aria-label`", () => {
    const result = runRule(headingHasContent, `const H = () => <h1 aria-label="Dashboard" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("exempts a heading named via `aria-labelledby`", () => {
    const result = runRule(headingHasContent, `const H = () => <h2 aria-labelledby="lbl" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an empty heading with no accessible name", () => {
    const result = runRule(headingHasContent, `const H = () => <h1 />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  // A heading that spreads props (`<h5 {...props} />` — forwardRef card
  // titles, markdown component overrides) can receive its children at
  // runtime, so it can't be proven empty and must not be flagged.
  it("exempts a heading that spreads props", () => {
    const result = runRule(headingHasContent, `const H = (props) => <h1 {...props} />;`);
    expect(result.diagnostics).toEqual([]);
  });
});
