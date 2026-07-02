import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { interactiveSupportsFocus } from "./interactive-supports-focus.js";

describe("a11y/interactive-supports-focus regressions", () => {
  it("exempts an interactive element whose tabIndex may arrive via a spread", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const X = (p) => <div role="button" onClick={p.onPress} {...p.focusProps} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a literal interactive element lacking tabIndex", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const X = (p) => <div role="button" onClick={p.onPress} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
