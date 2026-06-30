import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noStringFalseOnBooleanAttribute } from "./no-string-false-on-boolean-attribute.js";

describe("react-builtins/no-string-false-on-boolean-attribute — regressions", () => {
  // FP wave 4: custom elements (hyphenated tag names) own their attribute
  // semantics — many web components read `checked="false"` as a real
  // string/boolean, so the intrinsic-attribute heuristic must not apply.
  it("does not flag a string boolean attr on a custom element", () => {
    const result = runRule(
      noStringFalseOnBooleanAttribute,
      `const a = <sl-checkbox checked="false" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags a string boolean attr on an intrinsic element", () => {
    const result = runRule(
      noStringFalseOnBooleanAttribute,
      `const a = <input disabled="false" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
