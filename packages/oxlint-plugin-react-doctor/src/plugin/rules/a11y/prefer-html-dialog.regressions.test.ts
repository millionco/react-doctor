import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferHtmlDialog } from "./prefer-html-dialog.js";

describe("a11y/prefer-html-dialog regressions", () => {
  it('does not claim focus trapping for a non-modal `role="dialog"` (no aria-modal)', () => {
    const result = runRule(preferHtmlDialog, `<div role="dialog" aria-label="hi" />`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).not.toContain("focus trapping");
    expect(result.diagnostics[0].message).not.toContain("tab out");
  });

  it("does not flag a custom web component `<ui-modal>`", () => {
    const result = runRule(preferHtmlDialog, `<ui-modal role="dialog" />`);
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags a modal `<div role="dialog" aria-modal="true">` with the focus-trap message', () => {
    const result = runRule(preferHtmlDialog, `<div role="dialog" aria-modal="true" />`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("focus trapping");
  });

  it('still flags a bare `<div role="dialog">`', () => {
    const result = runRule(preferHtmlDialog, `<div role="dialog" />`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
