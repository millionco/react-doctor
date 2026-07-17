import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { htmlLabelHasSingleControl } from "./html-label-has-single-control.js";

describe("html-label-has-single-control", () => {
  it("reports labels containing multiple native controls", () => {
    const result = runRule(
      htmlLabelHasSingleControl,
      `const Range = () => <label>Range<input name="min" /><span>to</span><input name="max" /></label>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows one nested native control", () => {
    const result = runRule(
      htmlLabelHasSingleControl,
      `const Email = () => <label>Email<span><input name="email" /></span></label>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assume custom components are labelable", () => {
    const result = runRule(
      htmlLabelHasSingleControl,
      `const Email = () => <label>Email<Input /><ClearButton /></label>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
