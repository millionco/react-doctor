import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { buttonHasType } from "./button-has-type.js";

describe("react-builtins/button-has-type — regressions", () => {
  // Bugbot review: bare `<button type />` is shorthand for
  // `type={true}` — should be flagged as invalid type, not silently
  // accepted via `if (!value) return`.
  it("flags bare <button type />", () => {
    const result = runRule(buttonHasType, `<button type />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // A spread can forward `type` at runtime, so a button with only a
  // spread and no explicit `type` must not be flagged as missing.
  it("stays silent on <button {...props} /> (type may come via spread)", () => {
    const result = runRule(buttonHasType, `const Button = (props) => <button {...props} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an explicit invalid literal type alongside a spread", () => {
    const result = runRule(buttonHasType, `const Button = (props) => <button {...props} type="foo" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
