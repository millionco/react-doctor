import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noStringFalseOnBooleanAttribute } from "./no-string-false-on-boolean-attribute.js";

describe("no-string-false-on-boolean-attribute", () => {
  it('flags `disabled="false"` (the truthy-string footgun)', () => {
    const result = runRule(
      noStringFalseOnBooleanAttribute,
      `const A = () => <button disabled="false">Save</button>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("truthy");
    // Suggest the boolean-false form to keep it off, never the bare
    // shorthand (which would turn the attribute ON).
    expect(result.diagnostics[0].message).toContain("disabled={false}");
    expect(result.diagnostics[0].message).toContain("keep it off");
  });

  it('flags `checked="true"` with a value-appropriate message (not the "false" wording)', () => {
    const result = runRule(
      noStringFalseOnBooleanAttribute,
      `const A = () => <input type="checkbox" checked="true" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('not the string "true"');
    expect(result.diagnostics[0].message).not.toContain('wrote "false"');
  });

  it('flags `readOnly="false"` (React camelCase)', () => {
    const result = runRule(
      noStringFalseOnBooleanAttribute,
      `const A = () => <input readOnly="false" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the boolean-expression form", () => {
    const result = runRule(
      noStringFalseOnBooleanAttribute,
      `const A = ({ off }) => <button disabled={false} hidden={off}>x</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the shorthand form", () => {
    const result = runRule(noStringFalseOnBooleanAttribute, `const A = () => <input disabled />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag enumerated attributes that take "false" (aria-*, contentEditable, draggable)', () => {
    const result = runRule(
      noStringFalseOnBooleanAttribute,
      `const A = () => <div aria-pressed="false" contentEditable="false" draggable="false" spellCheck="false" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-boolean string attribute", () => {
    const result = runRule(
      noStringFalseOnBooleanAttribute,
      `const A = () => <input value="false" placeholder="false" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not flag a custom component `<Toggle disabled="false">`', () => {
    const result = runRule(
      noStringFalseOnBooleanAttribute,
      `const A = () => <Toggle disabled="false" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
