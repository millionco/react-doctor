import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { autocompleteValid } from "./autocomplete-valid.js";

describe("a11y/autocomplete-valid regressions", () => {
  it("accepts a `shipping` address qualifier before a field token", () => {
    const result = runRule(
      autocompleteValid,
      `const F = () => <input type="text" name="z" autoComplete="shipping postal-code" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a `billing` address qualifier before a field token", () => {
    const result = runRule(
      autocompleteValid,
      `const F = () => <input type="text" name="z" autoComplete="billing cc-number" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a contact qualifier before a contact field", () => {
    const result = runRule(
      autocompleteValid,
      `const F = () => <input type="text" autoComplete="home tel" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an unknown token", () => {
    const result = runRule(
      autocompleteValid,
      `const F = () => <input type="text" autoComplete="foo" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a trailing invalid token", () => {
    const result = runRule(
      autocompleteValid,
      `const F = () => <input type="text" autoComplete="name invalid" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a contact qualifier before a non-contact field", () => {
    const result = runRule(
      autocompleteValid,
      `const F = () => <input type="text" autoComplete="home url" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
