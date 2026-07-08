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

  it("stays quiet for a wrapper label whose spread props may carry htmlFor", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `
        const DefaultLabel = React.forwardRef((props, ref) => (
          <label {...props} ref={ref} />
        ));
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for a floating-label hook spreading label props over text", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `
        const Label = ({ className, ...props }) => (
          <label {...props} className={className}>
            {text}
          </label>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for a label nesting a control-named custom component", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `
        const SelectSort = ({ sortBy, handleSortChange }) => (
          <label>
            Sort:{" "}
            <SearchableSelect value={sortBy} onChange={handleSortChange}>
              <Option value="recent">Most Recent</Option>
            </SearchableSelect>
          </label>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet for a label wrapping a design-system Input", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `
        const Demo = ({ value, setValue }) => (
          <label className="grid gap-1.5 text-sm">
            <span>Property name</span>
            <Input value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
        );
      `,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("still reports a text-only label with no control and no htmlFor", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `
        const Demo = () => (
          <div>
            <label>Surname</label>
            <input type="text" />
          </div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
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

  // FN mining: an empty htmlFor associates nothing.
  it("flags a label with an empty-string htmlFor and no nested control", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `const Field = () => <label htmlFor="">Name</label>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still trusts a non-empty htmlFor", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `const Field = () => <label htmlFor="name">Name</label>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still trusts a dynamic htmlFor expression", () => {
    const result = runRule(
      labelHasAssociatedControl,
      `const Field = ({ id }) => <label htmlFor={id}>Name</label>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
