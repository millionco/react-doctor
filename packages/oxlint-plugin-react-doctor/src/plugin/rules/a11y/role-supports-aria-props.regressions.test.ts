import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { roleSupportsAriaProps } from "./role-supports-aria-props.js";

// HTML-AAM never upgrades an `<input>` to an implicit `combobox` from
// aria-* attributes alone; APG-compliant markup always carries an explicit
// role="combobox". These cases pin the revert of the ARIA-1.2 combobox
// heuristic in utils/get-implicit-role.ts (oxc parity).
describe("a11y/role-supports-aria-props regressions", () => {
  it("stays silent on range ARIA props supported by a native number input", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const NumberInput = ({ minimum, maximum, value }) => (
        <input
          type="number"
          min={minimum}
          max={maximum}
          value={value}
          aria-valuemin={minimum}
          aria-valuemax={maximum}
          aria-valuenow={value}
        />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("recognizes case-insensitive and expression-literal number input types", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const NumberInputs = ({ value }) => (
        <>
          <input TYPE="NUMBER" aria-valuenow={value} />
          <input type={"number"} aria-valuenow={value} />
        </>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("normalizes existing range and button input role branches", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const Inputs = ({ value, pressed }) => (
        <>
          <input type="RANGE" aria-valuenow={value} />
          <input type="BUTTON" aria-pressed={pressed} />
        </>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still treats an uppercase text input type as a textbox", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const TextInput = ({ value }) => <input type="TEXT" aria-valuenow={value} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("role `textbox`");
  });

  it("stays silent when a native input type cannot be resolved statically", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const Input = ({ inputType, minimum, maximum, value }) => (
        <input
          type={inputType}
          aria-valuemin={minimum}
          aria-valuemax={maximum}
          aria-valuenow={value}
        />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags range ARIA props on a native text input", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const TextInput = ({ minimum, maximum, value }) => (
        <input
          type="text"
          aria-valuemin={minimum}
          aria-valuemax={maximum}
          aria-valuenow={value}
        />
      );`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("still treats a missing or invalid static input type as a textbox", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const TextInputs = ({ value }) => (
        <>
          <input aria-valuenow={value} />
          <input type="counter" aria-valuenow={value} />
        </>
      );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("still honors an explicit role over a native number input role", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const TextInput = ({ value }) => (
        <input type="number" role="textbox" aria-valuenow={value} />
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags props unsupported by a native number input spinbutton", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const NumberInput = ({ expanded }) => (
        <input type="number" aria-expanded={expanded} />
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("role `spinbutton`");
  });

  it("flags unsupported props when the number type is an expression literal", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const NumberInput = ({ expanded }) => (
        <input type={"number"} aria-expanded={expanded} />
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("role `spinbutton`");
  });

  it("stays silent on range ARIA props supported by slider and explicit spinbutton roles", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const RangeInputs = ({ minimum, maximum, value }) => (
        <>
          <input
            type="range"
            aria-valuemin={minimum}
            aria-valuemax={maximum}
            aria-valuenow={value}
          />
          <input
            type="text"
            role="spinbutton"
            aria-valuemin={minimum}
            aria-valuemax={maximum}
            aria-valuenow={value}
          />
        </>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

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

  // The ported role→props table was missing spec-supported properties
  // (aria-query parity): aria-multiselectable on listbox/grid/tablist/tree/
  // treegrid and aria-readonly on 15 widget roles. Found by fuzzing
  // (oxc-project/oxc#20855 seeded the corpus reproducer).
  it("stays silent on aria-multiselectable for multiselect widget roles", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = () => (
        <>
          <ul role="listbox" aria-multiselectable="true" />
          <div role="grid" aria-multiselectable="true" />
          <div role="tablist" aria-multiselectable="true" />
          <div role="tree" aria-multiselectable="true" />
          <div role="treegrid" aria-multiselectable="true" />
        </>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on aria-readonly for widget roles that support it", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = () => (
        <>
          <div role="checkbox" aria-readonly="true" />
          <div role="combobox" aria-readonly="true" />
          <div role="gridcell" aria-readonly="true" />
          <div role="listbox" aria-readonly="true" />
          <div role="radiogroup" aria-readonly="true" />
          <div role="searchbox" aria-readonly="true" />
          <div role="slider" aria-readonly="true" />
          <div role="spinbutton" aria-readonly="true" />
          <div role="switch" aria-readonly="true" />
          <div role="textbox" aria-readonly="true" />
        </>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on aria-errormessage for treegrid", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = () => <div role="treegrid" aria-errormessage="err" aria-invalid="true" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags aria-multiselectable on roles that don't support it", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = () => <div role="radiogroup" aria-multiselectable="true" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a prop unsupported by BOTH branches of a ternary role", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = ({ grouped }) => (
        <div role={grouped ? "radiogroup" : "toolbar"} aria-multiselectable="true" />
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`radiogroup` / `toolbar`");
  });

  it("flags a prop unsupported by a const-bound role", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const groupRole = "radiogroup";
const F = () => <div role={groupRole} aria-multiselectable="true" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when one ternary branch supports the prop", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = ({ isList }) => (
        <div role={isList ? "listbox" : "radiogroup"} aria-multiselectable="true" />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a role resolved from a parameter", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = ({ widgetRole }) => <div role={widgetRole} aria-multiselectable="true" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  // `aria-x={undefined}` / `{null}` renders no attribute at all, so the
  // "role ignores it" claim has nothing to attach to (oxc is_nullish_value
  // parity — the conditional-clearing pattern is idiomatic React).
  it("does not flag an aria prop cleared with undefined", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = () => <div role="toolbar" aria-multiselectable={undefined} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an aria prop cleared with null on an implicit role", () => {
    const result = runRule(roleSupportsAriaProps, `const F = () => <li aria-checked={null} />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a role bound via a destructuring default (source may override)", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const { role = "toolbar" } = config;
const F = () => <div role={role} aria-multiselectable="true" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a space-separated fallback role list (conservative bail)", () => {
    const result = runRule(
      roleSupportsAriaProps,
      `const F = () => <div role="button link" aria-checked="true" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
