import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { threeNoIgnoredLinewidth } from "./three-no-ignored-linewidth.js";

describe("three-no-ignored-linewidth", () => {
  it("reports nondefault static widths on GPU line materials", () => {
    const code = `
      import { LineBasicMaterial, LineDashedMaterial } from "three";
      const basic = new LineBasicMaterial({ linewidth: 4 });
      new LineDashedMaterial({ linewidth: 2 });
      basic.linewidth = 3;
    `;
    expect(runRule(threeNoIgnoredLinewidth, code).diagnostics).toHaveLength(3);
  });

  it("allows one, dynamic widths, Line2 materials, and unrelated imports", () => {
    const code = `
      import { LineBasicMaterial } from "three";
      import { LineBasicMaterial as Other } from "svg-kit";
      new LineBasicMaterial({ linewidth: 1 });
      new LineBasicMaterial({ linewidth });
      new Other({ linewidth: 4 });
    `;
    expect(runRule(threeNoIgnoredLinewidth, code).diagnostics).toHaveLength(0);
  });
});
