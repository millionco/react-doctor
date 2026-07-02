import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noGrayOnColoredBackground } from "./no-gray-on-colored-background.js";

describe("no-gray-on-colored-background", () => {
  it("flags gray text on a saturated background", () => {
    const result = runRule(
      noGrayOnColoredBackground,
      `const C = () => <div className="bg-blue-600 text-gray-400">Hi</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags gray text on a dark background", () => {
    const result = runRule(
      noGrayOnColoredBackground,
      `const C = () => <div className="bg-emerald-900 text-slate-500">Hi</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // Light tints (`-50`/`-100`…`-400`) are near-white pastels where gray
  // text reads fine — only saturated `-500`..`-950` backgrounds qualify.
  it("does not flag gray text on a light tint background", () => {
    const result = runRule(
      noGrayOnColoredBackground,
      `const C = () => <div className="bg-blue-50 text-gray-600">Hi</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag gray text on a -300 tint background", () => {
    const result = runRule(
      noGrayOnColoredBackground,
      `const C = () => <div className="bg-blue-300 text-gray-600">Hi</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
