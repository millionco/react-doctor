import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noControlledInputValueWithoutStateUpdate } from "./no-controlled-input-value-without-state-update.js";

describe("no-controlled-input-value-without-state-update", () => {
  it("flags input with a string-literal value and an onChange", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="hello" onChange={(e) => log(e)} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags input with a numeric-literal value {123} and an onChange", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value={123} onChange={handleChange} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags textarea with a literal value and an onChange", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <textarea value="frozen" onChange={handleChange} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag value bound to state with an updating onChange", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => {
        const [value, setValue] = useState("");
        return <input value={value} onChange={(e) => setValue(e.target.value)} />;
      };`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a value bound to a prop identifier (syntax-only, no FP)", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const MyInput = ({ value }) => <input value={value} onChange={(e) => log(e)} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a readOnly input with a literal value", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="hello" readOnly onChange={handleChange} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a disabled input with a literal value", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="hello" disabled onChange={handleChange} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a literal value with no onChange (a different footgun)", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="hello" />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a radio whose literal value is the submission token", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input type="radio" value="a" checked onChange={handleChange} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a checkbox literal value", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input type="checkbox" value="a" onChange={handleChange} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when a spread could supply onChange/value", () => {
    const result = runRule(
      noControlledInputValueWithoutStateUpdate,
      `const C = () => <input value="hello" {...rest} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
