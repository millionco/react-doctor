import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { ariaActivedescendantHasTabindex } from "./aria-activedescendant-has-tabindex.js";

describe("a11y/aria-activedescendant-has-tabindex regressions", () => {
  // Docs-validation FP (cloudscape prompt-input token-mode): a
  // contentEditable editing host is natively focusable/tabbable, so it
  // doesn't need an explicit tabIndex.
  it('stays silent on a contentEditable="true" role=textbox div', () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div role="textbox" contentEditable="true" aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a bare contentEditable shorthand", () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div contentEditable aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when contentEditable is a runtime conditional", () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div role="textbox" contentEditable={disabled ? 'false' : 'true'} aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags a contentEditable="false" div without tabIndex', () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div contentEditable="false" aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a contentEditable={false} div without tabIndex", () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div contentEditable={false} aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a plain div with aria-activedescendant and no tabIndex", () => {
    const result = runRule(
      ariaActivedescendantHasTabindex,
      `<div aria-activedescendant={activeId} />`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
