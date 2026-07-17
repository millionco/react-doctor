import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPlaceholderOnlyField } from "./no-placeholder-only-field.js";

describe("no-placeholder-only-field", () => {
  it("flags an input that uses only a placeholder", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input placeholder="Email address" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a label associated by htmlFor", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <><label htmlFor="email">Email</label><input id="email" placeholder="name@example.com" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an input nested in a label", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <label>Email<input placeholder="name@example.com" /></label>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an explicitly named field", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input aria-label="Search" placeholder="Search docs" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer missing labels through spread props", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ field }) => <input placeholder="Email" {...field} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not apply to non-text controls", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input type="checkbox" placeholder="Ignored" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not apply to brace-wrapped non-text controls", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input type={'checkbox'} placeholder="Ignored" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips inputs whose type cannot be resolved", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ type }) => <input type={type} placeholder="Maybe a text field" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags brace-wrapped text input types", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input type={'email'} placeholder="Email address" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
