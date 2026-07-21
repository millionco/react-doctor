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

  it("does not flag an achromatic arbitrary border with an opacity modifier", () => {
    const result = run(`const C = () => <div className="border-l-4 border-l-[#e5e7eb]/50" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("abstains when an arbitrary border color cannot be resolved", () => {
    const result = run(
      `const C = () => <><div className="border-l-4 border-l-[var(--accent)]" /><div className="border-l-4 border-[var(--accent)]" /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a colored top edge on a rounded Tailwind surface", () => {
    const result = run(
      `const C = () => <div className="rounded-lg border-t-2 border-t-red-500" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a top edge on a square surface", () => {
    const result = run(`const C = () => <div className="border-t-4 border-t-red-500" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag structural borders that cover multiple sides", () => {
    const scannerCorner = run(
      `const C = () => <div className="rounded-tl border-t-2 border-l-2 border-brand-400" />;`,
    );
    const outlinedTab = run(
      `const C = () => <div className="rounded-t-md border-t-2 border-l-2 border-r-2 border-b-0 border-brand" />;`,
    );
    const accentWithZeroWidthReset = run(
      `const C = () => <div className="border-l-4 border-r-0 border-red-500" />;`,
    );
    expect(scannerCorner.diagnostics).toEqual([]);
    expect(outlinedTab.diagnostics).toEqual([]);
    expect(accentWithZeroWidthReset.diagnostics).toHaveLength(1);
  });

  it("abstains when equal-priority widths conflict on the same side", () => {
    const result = run(
      `const C = () => <div className="rounded border-l-2 border-l-4 border-red-500" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports duplicate identical width utilities", () => {
    const result = run(`const C = () => <div className="border-l-4 border-l-4 border-red-500" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("honors important side widths independently of class order", () => {
    const result = run(
      `const C = () => <><div className="border-l-0 !border-l-4 border-red-500" /><div className="!border-l-4 border-l-0 border-red-500" /><div className="border-l-4 !border-l-0 border-red-500" /><div className="!border-l-0 border-l-4 border-red-500" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("merges Tailwind and inline side widths by important precedence", () => {
    const result = run(
      `const A = () => <>
        <div className="border-l-8 border-red-500" style={{ borderLeftWidth: 0 }} />
        <div className="!border-l-0 border-red-500" style={{ borderLeftWidth: 8, borderLeftColor: "red" }} />
        <div className="!border-l-8 border-red-500" style={{ borderLeftWidth: 0 }} />
        <div className="border-l-8 border-red-500" style={{ borderLeftWidth: 8, borderLeftColor: "red" }} />
        <div className="!border-l-0 !border-l-8 border-red-500" style={{ borderLeftWidth: 8, borderLeftColor: "red" }} />
      </>`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("abstains for equal-priority width resets and important width conflicts", () => {
    const result = run(
      `const C = () => <><div className="border-l-4 border-l-0 border-red-500" /><div className="border-l-0 border-l-4 border-red-500" /><div className="!border-l-4 !border-l-0 border-red-500" /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("honors important rounding independently of class order", () => {
    const result = run(
      `const C = () => <><div className="rounded-none !rounded-lg border-t-2 border-red-500" /><div className="!rounded-lg rounded-none border-t-2 border-red-500" /><div className="rounded-lg !rounded-none border-t-2 border-red-500" /><div className="!rounded-none rounded-lg border-t-2 border-red-500" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("abstains when equal-priority rounding utilities conflict", () => {
    const result = run(
      `const C = () => <><div className="rounded-none rounded-lg border-t-2 border-red-500" /><div className="rounded-lg rounded-none border-t-2 border-red-500" /><div className="!rounded-none !rounded-lg border-t-2 border-red-500" /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("honors important side and base colors independently of class order", () => {
    const result = run(
      `const C = () => <><div className="border-l-4 border-l-gray-200 !border-l-red-500" /><div className="border-l-4 !border-l-red-500 border-l-gray-200" /><div className="border-l-4 border-l-red-500 !border-l-gray-200" /><div className="border-l-4 !border-gray-200 border-l-red-500" /><div className="border-l-4 border-gray-200 !border-l-red-500" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("abstains when equal-priority or important border colors conflict", () => {
    const result = run(
      `const C = () => <><div className="border-l-4 border-l-red-500 border-l-gray-200" /><div className="border-l-4 border-l-gray-200 border-l-red-500" /><div className="border-l-4 !border-l-red-500 !border-l-gray-200" /></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores variant-only side widths", () => {
    const result = run(`const C = () => <div className="hover:border-l-4 border-red-500" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps inline-style checks active without enabling Tailwind class detection", () => {
    const result = runRule(
      noSideTabBorder,
      `const C = () => <><div className="border-l-4 border-red-500" /><div style={{ borderLeft: "4px solid red" }} /></>;`,
      {
        filename: "fixture.tsx",
        settings: { "react-doctor": { capabilities: [] } },
      },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a colored bottom edge in a rounded inline style", () => {
    const result = run(
      `const C = () => <div style={{ borderRadius: 8, borderBottom: "3px solid red" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag Tailwind or inline loading spinners", () => {
    const tailwindResult = run(
      `const Spinner = () => <div className="animate-spin rounded-full border-b-2 border-blue-600" />;`,
    );
    const inlineResult = run(
      `const Spinner = () => <div className="spinner" style={{ borderRadius: "50%", borderTop: "4px solid blue", animation: "spin 1s linear infinite" }} />;`,
    );
    expect(tailwindResult.diagnostics).toEqual([]);
    expect(inlineResult.diagnostics).toEqual([]);
  });

  it("does not infer spinner utilities from arbitrary content", () => {
    const result = run(
      `const C = () => <div className="border-l-4 border-red-500 content-['animate-spin rounded-full']" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
