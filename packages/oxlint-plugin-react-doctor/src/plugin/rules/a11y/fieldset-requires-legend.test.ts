import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { fieldsetRequiresLegend } from "./fieldset-requires-legend.js";

describe("fieldset-requires-legend", () => {
  it("reports unnamed groups with multiple static controls", () => {
    const result = runRule(
      fieldsetRequiresLegend,
      `const Contact = () => <fieldset><label>Email<input /></label><label>Phone<input /></label></fieldset>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows direct legends and explicit accessible names", () => {
    const result = runRule(
      fieldsetRequiresLegend,
      `const Contact = () => <><fieldset><legend>Contact</legend><input /><input /></fieldset><fieldset aria-label="Contact"><input /><input /></fieldset></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips single-control, spread-owned, and custom groups", () => {
    const result = runRule(
      fieldsetRequiresLegend,
      `const Contact = ({ props }) => <><fieldset><input /></fieldset><fieldset {...props}><input /><input /></fieldset><Fieldset><input /><input /></Fieldset></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
