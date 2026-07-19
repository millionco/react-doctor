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

  it("flags a controlled radio because state does not provide native arrow-key grouping", () => {
    const result = runRule(
      radioInputMissingName,
      `<input type="radio" value="no" checked={value === "no"} onChange={handleChange} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a controlled radio used as a toggle because radio semantics require a group name", () => {
    const result = runRule(
      radioInputMissingName,
      `const Toggle = ({ isOn, onToggle }) => <input type="radio" checked={isOn} onChange={onToggle} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a defaultChecked (uncontrolled) radio with no name", () => {
    const result = runRule(
      radioInputMissingName,
      `<input type="radio" value="no" defaultChecked />;`,
    );
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

  it("flags an allowlisted member-expression radio component with no name (semantic-ui Form.Radio)", () => {
    const result = runRule(radioInputMissingName, `<Form.Radio value="a" />;`, {
      settings: {
        "react-doctor": { "radioInputMissingName.radioComponents": ["Form.Radio"] },
      },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a native radio inside a Group-named wrapper, which cannot supply name via context", () => {
    const result = runRule(
      radioInputMissingName,
      `<InputGroup><input type="radio" value="a" /></InputGroup>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag allowlisted Radios whose name comes from the group provider (antd/Mantine Radio.Group)", () => {
    const result = runRule(
      radioInputMissingName,
      `<Radio.Group name="framework"><Radio value="react" /><Radio value="vue" /></Radio.Group>;`,
      { settings: withRadioComponents },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag allowlisted Radios inside a nameless RadioGroup, which auto-generates a name (Chakra/Mantine)", () => {
    const result = runRule(
      radioInputMissingName,
      `<RadioGroup value={value} onChange={setValue}><div><Radio value="react" /></div></RadioGroup>;`,
      { settings: withRadioComponents },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([`name="answer"`, `name={"answer"}`, `name={42}`])(
    "does not flag a radio whose %s value creates a group",
    (nameAttribute) => {
      const result = runRule(
        radioInputMissingName,
        `<input type="radio" ${nameAttribute} value="yes" />;`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it.each([`name`, `name=""`, `name={false}`, `name={true}`, `name={null}`, `name={undefined}`])(
    "flags a radio whose %s value does not create a group",
    (nameAttribute) => {
      const result = runRule(
        radioInputMissingName,
        `<input type="radio" ${nameAttribute} value="yes" />;`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

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

  it("still flags an allowlisted Radio inside an unrelated FormGroup", () => {
    const result = runRule(radioInputMissingName, `<FormGroup><Radio value="a" /></FormGroup>;`, {
      settings: withRadioComponents,
    });
    expect(result.diagnostics).toHaveLength(1);
  });
});
