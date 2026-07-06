import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { labelHasAssociatedControl } from "./label-has-associated-control.js";

describe("a11y/label-has-associated-control regressions", () => {
  it("reports a label whose only child is a string-shaped identifier expression", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `
        const FieldGroup = ({ label, children }) => (
          <div>
            <label className="block text-xs text-gray-500 uppercase mb-2">{label}</label>
            {children}
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a label containing text plus a whitespace expression and an icon", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `
        const Demo = () => (
          <div>
            <label className="block text-sm font-medium mb-1">
              Port{" "}
              <HelpCircle title="Only secure websockets are supported" className="inline-block" />
            </label>
            <TextInput inputMode="numeric" />
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a label built from member expressions and arithmetic", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `
        const Demo = ({ config, index }) => (
          <div>
            <label className="text-xs text-gray-500 uppercase">
              {config?.itemLabel} {index + 1}
            </label>
            <input type="text" />
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet for wrapper labels rendering children", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `
        const Field = ({ label, children }) => (
          <label>
            <span>{label}</span>
            {children}
          </label>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for labels rendering a helper call or conditional control", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `
        const Demo = ({ renderInput, isMultiline, value }) => (
          <div>
            <label>Amount {renderInput()}</label>
            <label>
              Notes
              {isMultiline ? <textarea value={value} /> : <input value={value} />}
            </label>
          </div>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });
});
