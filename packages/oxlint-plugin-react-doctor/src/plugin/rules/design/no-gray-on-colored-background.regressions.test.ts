import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noGrayOnColoredBackground } from "./no-gray-on-colored-background.js";

const run = (code: string) => runRule(noGrayOnColoredBackground, code, { filename: "fixture.tsx" });

describe("design/no-gray-on-colored-background — regressions", () => {
  it("does not flag near-white text-gray-100 (the recommended choice)", () => {
    const result = run(`const C = () => <div className="bg-blue-600 text-gray-100">Hi</div>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag near-white text-zinc-200", () => {
    const result = run(`const C = () => <div className="bg-rose-700 text-zinc-200">Hi</div>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag near-white text-slate-300", () => {
    const result = run(`const C = () => <div className="bg-blue-600 text-slate-300">Hi</div>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags washed-out text-gray-400", () => {
    const result = run(`const C = () => <div className="bg-blue-600 text-gray-400">Hi</div>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags washed-out text-slate-500", () => {
    const result = run(`const C = () => <div className="bg-blue-600 text-slate-500">Hi</div>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag gray text and colored bg living in different variant scopes", () => {
    const result = run(
      `const C = () => <div className="bg-white text-gray-500 dark:bg-blue-600 dark:text-white" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags gray text and colored bg sharing the same variant scope", () => {
    const result = run(`const C = () => <div className="dark:bg-blue-600 dark:text-gray-500" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags base gray text under a variant colored bg with no text override", () => {
    const result = run(`const C = () => <div className="text-gray-500 dark:bg-blue-600">Hi</div>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a base colored bg with a variant-only gray text override", () => {
    const result = run(
      `const C = () => <div className="bg-blue-600 text-white dark:text-gray-500">Hi</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the important modifier !text-gray-500 on bg-blue-600", () => {
    const result = run(`const C = () => <div className="bg-blue-600 !text-gray-500">Hi</div>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags reordered variant stacks as the same scope (md:hover == hover:md)", () => {
    const result = run(
      `const C = () => <div className="md:hover:text-gray-500 hover:md:bg-blue-600">Hi</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags near-black text-gray-950 on a dark colored background", () => {
    const result = run(`const C = () => <div className="bg-emerald-900 text-gray-950">Hi</div>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a translucent tint background (bg-blue-500/10)", () => {
    const result = run(`const C = () => <div className="bg-blue-500/10 text-gray-600">Hi</div>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag muted light gray on a near-black colored background", () => {
    const result = run(`const C = () => <div className="bg-blue-950 text-gray-400">Hi</div>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag near-black gray text on a bright yellow background", () => {
    const result = run(`const C = () => <div className="bg-yellow-500 text-gray-900">Hi</div>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag near-black gray text on a bright amber background", () => {
    const result = run(`const C = () => <div className="bg-amber-500 text-gray-950">Hi</div>;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags mid gray on a bright yellow background", () => {
    const result = run(`const C = () => <div className="bg-yellow-500 text-gray-500">Hi</div>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags mid gray on a solid mid-shade colored background", () => {
    const result = run(`const C = () => <div className="bg-blue-600 text-gray-500">Hi</div>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags dark gray on a dark colored background of similar depth", () => {
    const result = run(`const C = () => <div className="bg-blue-900 text-gray-600">Hi</div>;`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
