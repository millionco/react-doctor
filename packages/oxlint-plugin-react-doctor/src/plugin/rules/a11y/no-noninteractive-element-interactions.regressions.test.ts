import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNoninteractiveElementInteractions } from "./no-noninteractive-element-interactions.js";

describe("a11y/no-noninteractive-element-interactions regressions", () => {
  it("exempts a handler on an element hidden from screen readers", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li aria-hidden="true" onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a handler on a visible non-interactive element", () => {
    const result = runRule(noNoninteractiveElementInteractions, `<li onClick={() => {}}>x</li>`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
