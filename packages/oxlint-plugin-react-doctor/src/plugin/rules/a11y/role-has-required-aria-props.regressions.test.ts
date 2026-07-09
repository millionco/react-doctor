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

  // Docs-validation FP (mapguide test mock): a native `<select>` already
  // carries the implicit combobox role with built-in expansion semantics,
  // so a redundant explicit role doesn't need aria-controls/aria-expanded.
  it('exempts a native `<select role="combobox">`', () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const S = ({ value, onChange }) => <select role="combobox" value={value} onChange={onChange} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags a custom `<div role="combobox">` missing its required props', () => {
    const result = runRule(roleHasRequiredAriaProps, `const C = () => <div role="combobox" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  // The doc's named native-backing FP: a native `<option>` supplies
  // selectedness from its DOM `selected` state.
  it('exempts a native `<option role="option">`', () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const O = () => <option role="option" value="a">A</option>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags a custom `<div role="option">` missing aria-selected', () => {
    const result = runRule(roleHasRequiredAriaProps, `const O = () => <div role="option" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a ternary role whose branches both miss their required props", () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const T = ({ single }) => <div role={single ? "radio" : "checkbox"} />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a const-bound role missing its required props", () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const toggleRole = "switch";
const T = () => <div role={toggleRole} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a ternary role when the required props are present", () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const T = ({ single, isOn }) => (
        <div role={single ? "radio" : "checkbox"} aria-checked={isOn} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a role resolved from a parameter", () => {
    const result = runRule(
      roleHasRequiredAriaProps,
      `const T = ({ widgetRole }) => <div role={widgetRole} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
