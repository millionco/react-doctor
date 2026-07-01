import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { radioInputMissingName } from "./radio-input-missing-name.js";

const withRadioComponents = {
  "react-doctor": { "radioInputMissingName.radioComponents": ["Radio"] },
};

describe("radio-input-missing-name", () => {
  it("flags a native radio input with no name", () => {
    const result = runRule(radioInputMissingName, `<input type="radio" value="yes" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a radio with checked/onChange but still no name", () => {
    const result = runRule(
      radioInputMissingName,
      `<input type="radio" value="no" checked onChange={handleChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags two sibling radios in a fieldset, neither with name", () => {
    const result = runRule(
      radioInputMissingName,
      `function Options() {
        return (
          <fieldset>
            <input type="radio" value="a" />
            <input type="radio" value="b" />
          </fieldset>
        );
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags an allowlisted Radio component with no name", () => {
    const result = runRule(
      radioInputMissingName,
      `<Radio value="a" align="flex-start" onClick={onSelect} active={selected} />;`,
      { settings: withRadioComponents },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a radio that has a name", () => {
    const result = runRule(
      radioInputMissingName,
      `<input type="radio" name="answer" value="yes" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a radio with a dynamic name expression", () => {
    const result = runRule(
      radioInputMissingName,
      `<input type="radio" name={fieldName} value="yes" />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a radio with a spread attribute", () => {
    const result = runRule(
      radioInputMissingName,
      `<input type="radio" {...register('answer')} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a radio with a generic spread", () => {
    const result = runRule(radioInputMissingName, `<input type="radio" {...props} value="yes" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a checkbox", () => {
    const result = runRule(radioInputMissingName, `<input type="checkbox" value="yes" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a text input", () => {
    const result = runRule(radioInputMissingName, `<input type="text" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an input with a dynamic type", () => {
    const result = runRule(radioInputMissingName, `<input type={dynamicType} value="yes" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a Radio component when the allowlist is empty (default)", () => {
    const result = runRule(radioInputMissingName, `<MyRadio value="a" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a bare Radio when it is not in the allowlist", () => {
    const result = runRule(radioInputMissingName, `<Radio value="a" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
