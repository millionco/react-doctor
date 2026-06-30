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

  it("stays silent when every dynamic role branch is an interactive role", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={cond ? "checkbox" : "radio"} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // Bugbot wave 4: a `&&` role short-circuits to `false` when the guard is
  // falsy, so the element is sometimes role-less — it must still be flagged.
  it("flags a `&&` role that can short-circuit to a non-role value", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={enabled && "button"} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // …and a ternary whose alternate is `null` leaves the element role-less.
  it("flags a ternary role with a nullish branch", () => {
    const result = runRule(
      noNoninteractiveElementInteractions,
      `<li role={show ? "button" : null} onClick={() => {}}>x</li>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
