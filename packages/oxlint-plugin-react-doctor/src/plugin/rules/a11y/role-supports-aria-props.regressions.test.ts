import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { roleSupportsAriaProps } from "./role-supports-aria-props.js";

// HTML-AAM never upgrades an `<input>` to an implicit `combobox` from
// aria-* attributes alone; APG-compliant markup always carries an explicit
// role="combobox". These cases pin the revert of the ARIA-1.2 combobox
// heuristic in utils/get-implicit-role.ts (oxc parity).
describe("a11y/role-supports-aria-props regressions", () => {
  it("flags aria-expanded on a plain text input (implicit textbox, oxc parity)", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = () => <input type="text" aria-expanded />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags aria-expanded on an input with aria-controls + aria-autocomplete (no implicit combobox upgrade)", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = () => <input type="text" aria-controls="lb" aria-autocomplete="list" aria-expanded />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags aria-expanded on an input with aria-controls + aria-activedescendant", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = () => <input aria-controls="lb" aria-activedescendant="opt1" aria-expanded />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags aria-expanded on an input with aria-haspopup="listbox"', () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = () => <input aria-haspopup="listbox" aria-expanded />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on textbox-supported aria props of an implicit textbox input", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = () => <input aria-autocomplete="list" aria-controls="lb" aria-placeholder="Search" aria-multiline={false} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('stays silent on the APG combobox with an explicit role="combobox"', () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = ({ open }) => <input type="text" role="combobox" aria-autocomplete="list" aria-controls="lb" aria-expanded={open} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
