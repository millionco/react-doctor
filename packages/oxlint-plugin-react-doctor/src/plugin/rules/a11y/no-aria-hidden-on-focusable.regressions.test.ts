import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAriaHiddenOnFocusable } from "./no-aria-hidden-on-focusable.js";

describe("a11y/no-aria-hidden-on-focusable regressions", () => {
  it("does not flag a dynamic aria-hidden expression on a focusable element", () => {
    const result = runRule(
      noAriaHiddenOnFocusable,
      `export const A = ({ interactive }) => (
        <button aria-hidden={!interactive || undefined} type="button">x</button>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a literal aria-hidden on a focusable element", () => {
    const result = runRule(
      noAriaHiddenOnFocusable,
      `export const A = () => <button aria-hidden={true} type="button">x</button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
