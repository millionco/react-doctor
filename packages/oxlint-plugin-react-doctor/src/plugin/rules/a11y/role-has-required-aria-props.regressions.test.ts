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

  it('exempts a bare native checkbox `role="switch"` (native checked state is intrinsic)', () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const T = () => <input type="checkbox" role="switch" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('exempts a native checkbox `role="switch"` receiving its props via a spread', () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const T = (props) => <input type="checkbox" role="switch" {...props} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('exempts the mined ant-design shape `<Checkbox.Group role="checkbox">` (custom component DOM is unknowable)', () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const T = () => <Checkbox.Group options={['Apple', 'Pear', 'Orange']} role="checkbox" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('exempts the mined ant-design shape `<Radio.Group role="checkbox">`', () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const T = () => <Radio.Group options={['Apple']} role="checkbox" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('exempts a custom component `<MySwitch role="switch">`', () => {
    const result = runRule(roleHasRequiredAriaProps, `const T = () => <MySwitch role="switch" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags a custom `<div role="checkbox">` missing aria-checked', () => {
    const result = runRule(roleHasRequiredAriaProps, `const T = () => <div role="checkbox" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('still flags `<input type="text" role="slider">` missing aria-valuenow', () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const T = () => <input type="text" role="slider" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it('exempts a native `<input type="range" role="slider">` (range supplies aria-valuenow)', () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const R = () => <input type="range" role="slider" defaultValue={5} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags a custom `<div role="slider">` missing aria-valuenow', () => {
    const result = runRule(roleHasRequiredAriaProps, `const R = () => <div role="slider" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('exempts a native `<h1 role="heading">` (the heading level is intrinsic)', () => {
    const result = runRule(roleHasRequiredAriaProps, `const H = () => <h1 role="heading">Hi</h1>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags a custom `<div role="heading">` missing aria-level', () => {
    const result = runRule(roleHasRequiredAriaProps, `const H = () => <div role="heading" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
