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
});
