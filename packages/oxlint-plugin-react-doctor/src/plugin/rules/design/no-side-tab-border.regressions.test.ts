import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSideTabBorder } from "./no-side-tab-border.js";

const run = (code: string) => runRule(noSideTabBorder, code, { filename: "fixture.tsx" });

describe("design/no-side-tab-border — regressions", () => {
  it("does not flag an achromatic arbitrary border (border-[#e5e7eb] == gray-200)", () => {
    const result = run(`const C = () => <div className="border-l-4 border-[#e5e7eb]" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an achromatic arbitrary rgb border", () => {
    const result = run(`const C = () => <div className="border-l-4 border-[rgb(229,231,235)]" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still does not flag a named neutral border (control)", () => {
    const result = run(`const C = () => <div className="border-l-4 border-gray-200" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a colored arbitrary border", () => {
    const result = run(`const C = () => <div className="border-l-4 border-[#ff0000]" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a side-scoped achromatic arbitrary color (border-l-[#e5e7eb])", () => {
    const result = run(`const C = () => <div className="border-l-4 border-l-[#e5e7eb]" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags an achromatic base with a COLORED arbitrary side accent", () => {
    const result = run(
      `const C = () => <div className="border border-[#e5e7eb] border-l-4 border-l-[#ef4444]" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a neutral named base with a colored named side accent", () => {
    const result = run(
      `const C = () => <div className="border border-gray-200 border-l-4 border-l-red-500" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an achromatic tailwind underscore rgb border", () => {
    const result = run(`const C = () => <div className="border-l-4 border-[rgb(229_231_235)]" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an achromatic hsl arbitrary border", () => {
    const result = run(`const C = () => <div className="border-l-4 border-[hsl(0,0%,90%)]" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a colored arbitrary border when only the base carries the color", () => {
    const result = run(`const C = () => <div className="border-l-4 border-[#dc2626]" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
