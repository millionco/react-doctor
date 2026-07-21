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

  it("only evaluates proven intrinsic elements", () => {
    const result = runRule(
      noGrayOnColoredBackground,
      `const BadgeElement = "span"; const C = () => <><Badge className="bg-blue-600 text-gray-400" /><BadgeElement className="bg-blue-600 text-gray-400" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes fully opaque background modifiers", () => {
    const result = runRule(
      noGrayOnColoredBackground,
      `const C = () => <><div className="bg-blue-600/100 text-gray-400">Opaque</div><div className="bg-blue-600/[100%] text-gray-400">Opaque</div><div className="bg-blue-600/50 text-gray-400">Translucent</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
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

  it("abstains when equal-priority text or background colors conflict", () => {
    const result = runRule(
      noGrayOnColoredBackground,
      `const C = () => <><div className="bg-blue-600 text-gray-400 text-white">Text conflict</div><div className="text-gray-400 bg-blue-600 bg-white">Background conflict</div><div className="dark:bg-blue-600 dark:text-gray-400 dark:text-white">Variant conflict</div></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("honors important colors independently of class order", () => {
    const result = runRule(
      noGrayOnColoredBackground,
      `const C = () => <><div className="bg-white !bg-blue-600 text-white !text-gray-400">First</div><div className="!bg-blue-600 bg-white !text-gray-400 text-white">Second</div><div className="bg-blue-600 !bg-white text-gray-400">Safe</div><div className="bg-blue-600 text-gray-400 !text-white">Safe</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("abstains when important colors conflict", () => {
    const result = runRule(
      noGrayOnColoredBackground,
      `const C = () => <><div className="bg-blue-600 !text-gray-400 !text-white">Text conflict</div><div className="text-gray-400 !bg-blue-600 !bg-white">Background conflict</div></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
