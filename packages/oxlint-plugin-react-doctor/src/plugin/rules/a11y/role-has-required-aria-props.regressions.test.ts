import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { roleHasRequiredAriaProps } from "./role-has-required-aria-props.js";

describe("a11y/role-has-required-aria-props regressions", () => {
  it('exempts a native checkbox `role="switch"` that binds the checked state', () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const T = () => <input type="checkbox" role="switch" checked={e} onChange={t} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags a custom `<div role="switch">` missing aria-checked', () => {
    const result = runRule(roleHasRequiredAriaProps, `const T = () => <div role="switch" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('still flags a native checkbox `role="switch"` with no checked binding', () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const T = () => <input type="checkbox" role="switch" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
