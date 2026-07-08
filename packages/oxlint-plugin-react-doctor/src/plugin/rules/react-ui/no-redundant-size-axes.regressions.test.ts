import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRedundantSizeAxes } from "./no-redundant-size-axes.js";

const run = (code: string) => runRule(noRedundantSizeAxes, code, { filename: "fixture.tsx" });

describe("react-ui/no-redundant-size-axes — regressions", () => {
  it("reports the w/h house style once per file, not per icon", () => {
    const result = run(
      `const C = () => (
        <div>
          <svg className="w-4 h-4" />
          <svg className="w-4 h-4" />
          <svg className="w-6 h-6" />
          <img className="h-8 w-8" />
        </div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports one pair even when a single class list has several", () => {
    const result = run(`const C = () => <div className="w-4 h-4 w-8 h-8" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a redundant pair", () => {
    const result = run(`const C = () => <span className="inline-block w-10 h-10 rounded" />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("size-10");
  });

  it("does not flag mismatched axes", () => {
    const result = run(`const C = () => <div className="w-4 h-6" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag fraction widths with no size-* shorthand", () => {
    const result = run(`const C = () => <div className="w-1/2 h-1/2" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag class lists with responsive axis overrides", () => {
    const result = run(`const C = () => <div className="w-4 h-4 md:w-8" />;`);
    expect(result.diagnostics).toEqual([]);
  });
});
