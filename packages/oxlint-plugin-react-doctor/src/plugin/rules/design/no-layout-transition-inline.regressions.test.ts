import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLayoutTransitionInline } from "./no-layout-transition-inline.js";

const run = (code: string) => runRule(noLayoutTransitionInline, code, { filename: "fixture.tsx" });

describe("design/no-layout-transition-inline — regressions", () => {
  it("does not flag a transition on `scroll-margin` (scroll-snap offset, not box model)", () => {
    const result = run(`const C = () => <div style={{ transition: "scroll-margin 0.3s" }} />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a transition on `scroll-padding`", () => {
    const result = run(`const C = () => <div style={{ transition: "scroll-padding 0.3s" }} />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a transition on plain `margin`", () => {
    const result = run(`const C = () => <div style={{ transition: "margin 0.3s" }} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a transition on `padding-top`", () => {
    const result = run(`const C = () => <div style={{ transition: "padding-top 0.3s" }} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a transition on `border-width`", () => {
    const result = run(`const C = () => <div style={{ transition: "border-width 0.3s" }} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a transition on `line-height`", () => {
    const result = run(`const C = () => <div style={{ transition: "line-height 0.3s" }} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a transition on `column-width`", () => {
    const result = run(`const C = () => <div style={{ transition: "column-width 0.2s" }} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a height/y transition on an SVG <rect> (paint, not reflow)", () => {
    const result = run(
      `const Bar = ({ x, y, h }) => (
        <rect x={x} y={y} width="4" height={h} rx="2" style={{ transition: 'y 0.08s linear, height 0.08s linear' }} />
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a width transition on an SVG <circle>", () => {
    const result = run(`const Dot = () => <circle r="4" style={{ transition: "width 0.2s" }} />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a height transition on an HTML element", () => {
    const result = run(`const C = () => <div style={{ transition: "height 0.3s ease" }} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
