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

  it("flags static chromatic inset shadows that paint one 3–12px edge", () => {
    const result = run(
      `const C = () => <>
        <div style={{ boxShadow: "inset 4px 0 0 #ef4444" }} />
        <div style={{ boxShadow: "red -3px 0 inset" }} />
        <div style={{ boxShadow: "inset 0 12px rgb(37 99 235 / 50%)" }} />
        <div style={{ boxShadow: "0 -8px 0 0 hsl(280 70% 50%) inset" }} />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("flags supported Tailwind arbitrary inset shadows", () => {
    const result = run(
      `const C = () => <>
        <div className="shadow-[inset_4px_0_0_#ef4444]" />
        <div className="shadow-[rgb(37_99_235/0.5)_0_-6px_inset]" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps neutral and transparent inset shadows quiet", () => {
    const result = run(
      `const C = () => <>
        <div style={{ boxShadow: "inset 4px 0 0 black" }} />
        <div style={{ boxShadow: "inset 4px 0 0 #e5e7eb" }} />
        <div style={{ boxShadow: "inset 4px 0 0 rgb(120 120 120)" }} />
        <div style={{ boxShadow: "inset 4px 0 0 rgba(255, 0, 0, 0)" }} />
        <div style={{ boxShadow: "inset 4px 0 0 #f000" }} />
        <div className="shadow-[inset_4px_0_0_rgb(120_120_120)]" />
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps non-stripe shadow geometry quiet", () => {
    const result = run(
      `const C = () => <>
        <div style={{ boxShadow: "inset 2px 0 0 red" }} />
        <div style={{ boxShadow: "inset 13px 0 0 red" }} />
        <div style={{ boxShadow: "inset 4px 4px 0 red" }} />
        <div style={{ boxShadow: "inset 4px 0 2px red" }} />
        <div style={{ boxShadow: "inset 4px 0 0 1px red" }} />
        <div style={{ boxShadow: "inset 4px 0 0 red, 0 1px 2px black" }} />
        <div className="shadow-[inset_4px_0_2px_#ef4444]" />
        <div className="shadow-[inset_4px_0_0_#ef4444,0_1px_2px_#000]" />
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("abstains from dynamic and unresolved inset shadow values", () => {
    const result = run(
      `const C = ({ shadow }) => <>
        <div style={{ boxShadow: shadow }} />
        <div style={{ boxShadow: "inset 4px 0 0 var(--accent)" }} />
        <div style={{ boxShadow: "inset 4px 0 0 brand" }} />
        <div className="shadow-[inset_4px_0_0_var(--accent)]" />
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps focus, selection, and interactive inset indicators quiet", () => {
    const result = run(
      `const C = ({ selected }) => <>
        <button style={{ boxShadow: "inset 4px 0 0 red" }}>Save</button>
        <a href="/" className="shadow-[inset_4px_0_0_#ef4444]">Home</a>
        <div role="tab" style={{ boxShadow: "inset 4px 0 0 red" }} />
        <div aria-selected={selected} className="shadow-[inset_4px_0_0_#ef4444]" />
        <div aria-current="page" style={{ boxShadow: "inset 4px 0 0 red" }} />
        <div className="focus:shadow-[inset_4px_0_0_#ef4444]" />
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags inactive aria selection states", () => {
    const result = run(
      `const C = () => <>
        <div aria-selected={false} style={{ boxShadow: "inset 4px 0 0 red" }} />
        <div aria-current="false" className="shadow-[inset_4px_0_0_#ef4444]" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("abstains from ambiguous Tailwind shadows and honors inline precedence", () => {
    const result = run(
      `const C = () => <>
        <div className="shadow-[inset_4px_0_0_#ef4444] shadow-none" />
        <div className="!shadow-none shadow-[inset_4px_0_0_#ef4444]" />
        <div className="shadow-[inset_4px_0_0_#ef4444]" style={{ boxShadow: "none" }} />
        <div className="!shadow-[inset_4px_0_0_#ef4444]" style={{ boxShadow: "none" }} />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags static vertical pseudo-element stripes on short labels", () => {
    const result = run(
      `const C = () => <>
        <div className="relative before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500">Projects</div>
        <span className="relative side-tab after:absolute after:right-0 after:top-2 after:bottom-3 after:w-[3px] after:bg-[rgb(37_99_235)]" />
        <div className="relative after:absolute after:right-0 after:h-full after:w-3 after:bg-emerald-500">Deployment</div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("flags horizontal pseudo-element stripes that nearly span a label", () => {
    const result = run(
      `const C = () => <>
        <div className="relative before:absolute before:bottom-0 before:inset-x-1 before:h-2 before:bg-blue-500">Release status</div>
        <span className="relative label after:absolute after:top-0 after:left-[20px] after:right-5 after:h-[3px] after:bg-[#ef4444]" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("keeps neutral, transparent, unresolved, and non-stripe pseudo fills quiet", () => {
    const result = run(
      `const C = () => <>
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-gray-500" />
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-transparent" />
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500/0" />
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-[#ff0000]/0" />
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-[#ff0000]/[0%]" />
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-[var(--accent)]" />
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-0.5 before:bg-red-500" />
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-4 before:bg-red-500" />
        <span className="relative label before:absolute before:left-1 before:inset-y-0 before:w-1 before:bg-red-500" />
        <span className="relative label before:absolute before:left-0 before:top-0 before:w-1 before:bg-red-500" />
        <span className="relative label before:absolute before:left-0 before:top-[var(--start)] before:bottom-0 before:w-1 before:bg-red-500" />
        <span className="relative label before:absolute before:left-0 before:top-[var(--start)] before:h-full before:w-1 before:bg-red-500" />
        <span className="label before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500" />
        <span className="relative static label before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500" />
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("abstains from conditional, selected, and ambiguous pseudo constructions", () => {
    const result = run(
      `const C = ({ selected }) => <>
        <span className="relative label hover:before:absolute hover:before:left-0 hover:before:inset-y-0 hover:before:w-1 hover:before:bg-red-500" />
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-1 focus:before:bg-red-500" />
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-1 aria-selected:before:bg-red-500" />
        <span aria-selected={selected} className="relative before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500">Settings</span>
        <span aria-current="page" className="relative before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500">Home</span>
        <span data-state={selected ? "active" : "idle"} className="relative before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500">Filters</span>
        <span className="relative label selected before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500" />
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-1 before:w-2 before:bg-red-500" />
        <span className="relative label before:absolute before:left-0 before:right-0 before:inset-y-0 before:w-1 before:bg-red-500" />
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps horizontal link underlines quiet without exempting vertical link stripes", () => {
    const result = run(
      `const C = () => <>
        <a href="/" className="relative before:absolute before:bottom-0 before:inset-x-0 before:h-1 before:bg-blue-500">Docs</a>
        <Button className="relative after:absolute after:top-0 after:inset-x-0 after:h-1 after:bg-red-500">Save</Button>
        <a href="/" className="relative before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-blue-500">Account</a>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps structural and glyph-sized pseudo artwork quiet", () => {
    const result = run(
      `const C = () => <>
        <blockquote className="relative side-tab before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500">Quote</blockquote>
        <table className="relative side-tab before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500"><tbody /></table>
        <svg className="relative side-tab before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500" />
        <LogoMark className="relative side-tab before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500" />
        <span className="relative logo-mark before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500" />
        <span className="relative label size-10 before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500" />
      </>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat narrow labeled tabs as glyph artwork", () => {
    const result = run(
      `const C = () => <>
        <span className="relative label h-24 w-10 before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500">Analytics</span>
        <span className="relative label size-10 before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-blue-500">Beta</span>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("requires a static label or explicit side-tab context", () => {
    const result = run(
      `const C = ({ label, className }) => <>
        <div className="relative before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500">{label}</div>
        <div className={className}>Reports</div>
        <div className="relative side-tab before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500">{label}</div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("honors important pseudo geometry and abstains from important conflicts", () => {
    const result = run(
      `const C = () => <>
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-1 before:!w-2 before:bg-red-500" />
        <span className="relative label before:absolute before:left-0 before:inset-y-0 before:!w-1 before:!w-2 before:bg-red-500" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags pseudo stripes with explicitly inactive selection attributes", () => {
    const result = run(
      `const C = () => <>
        <span aria-selected={false} className="relative before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500">Reports</span>
        <span aria-current="false" className="relative before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500">Archive</span>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not inspect pseudo Tailwind utilities when Tailwind capability is disabled", () => {
    const result = runRule(
      noSideTabBorder,
      `const C = () => <span className="relative label before:absolute before:left-0 before:inset-y-0 before:w-1 before:bg-red-500" />;`,
      {
        filename: "fixture.tsx",
        settings: { "react-doctor": { capabilities: [] } },
      },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
