import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noGenericPurpleBlueIconGradient } from "./no-generic-purple-blue-icon-gradient.js";

describe("no-generic-purple-blue-icon-gradient", () => {
  it("reports compact rounded purple-to-blue icon tiles", () => {
    const result = runRule(
      noGenericPurpleBlueIconGradient,
      `const Brand = () => <><div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center"><BotIcon /></div><span className="size-5 rounded-full bg-linear-to-r from-violet-500 to-cyan-500 inline-flex">🤖</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports Tailwind v4 angle and radial gradients", () => {
    const result = runRule(
      noGenericPurpleBlueIconGradient,
      `const Brand = () => <><div className="size-8 rounded-lg bg-linear-45 from-purple-500 to-blue-500 flex" /><div className="size-8 rounded-lg bg-radial from-violet-500 to-cyan-500 grid" /><div className="size-8 rounded-lg bg-none from-purple-500 to-blue-500 flex" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows page gradients, large artwork, and restrained icon surfaces", () => {
    const result = runRule(
      noGenericPurpleBlueIconGradient,
      `const Page = () => <><main className="min-h-screen bg-gradient-to-br from-purple-500 to-blue-500" /><div className="size-64 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex" /><div className="size-8 w-64 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex" /><div className="size-8 rounded-lg bg-slate-900 flex"><BotIcon /></div></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips custom components and spread-overridable class contracts", () => {
    const result = runRule(
      noGenericPurpleBlueIconGradient,
      `const IconTile = ({ className }) => <span className={className} />; const Icon = ({ props }) => <><IconTile className="size-8 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 flex" /><div className="size-8 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 flex" {...props} /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not combine stops across responsive or dark variants", () => {
    const result = runRule(
      noGenericPurpleBlueIconGradient,
      `const Icon = () => <div className="size-8 rounded-lg bg-gradient-to-br from-purple-500 dark:to-blue-500 flex" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("uses the final utility for conflicting visual properties", () => {
    const result = runRule(
      noGenericPurpleBlueIconGradient,
      `const Icons = () => <><div className="size-8 rounded-lg rounded-none bg-gradient-to-r from-purple-500 to-blue-500 flex" /><div className="size-8 rounded-lg bg-gradient-to-r from-purple-500 from-red-500 to-blue-500 flex" /><div className="size-8 rounded-lg bg-gradient-to-r bg-none from-purple-500 to-blue-500 flex" /><div className="size-8 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 flex hidden" /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("honors important utilities independently of class order", () => {
    const result = runRule(
      noGenericPurpleBlueIconGradient,
      `const Icons = () => <><div className="size-64 !size-8 rounded-none !rounded-lg bg-none !bg-gradient-to-r from-red-500 !from-purple-500 to-blue-500 hidden !flex" /><div className="!size-8 size-64 !rounded-lg rounded-none !bg-gradient-to-r bg-none !from-purple-500 from-red-500 to-blue-500 !flex hidden" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("abstains when important visual utilities conflict", () => {
    const result = runRule(
      noGenericPurpleBlueIconGradient,
      `const Icons = () => <><div className="size-8 !rounded-lg !rounded-none bg-gradient-to-r from-purple-500 to-blue-500 flex" /><div className="size-8 rounded-lg !bg-gradient-to-r !bg-none from-purple-500 to-blue-500 flex" /><div className="size-8 rounded-lg bg-gradient-to-r !from-purple-500 !from-red-500 to-blue-500 flex" /><div className="!size-8 !size-12 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 flex" /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
