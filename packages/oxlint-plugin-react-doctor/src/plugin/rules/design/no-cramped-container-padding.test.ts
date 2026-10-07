import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCrampedContainerPadding } from "./no-cramped-container-padding.js";

describe("no-cramped-container-padding", () => {
  it("flags text in a bordered Tailwind container with 4px padding", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Panel = () => <div className="border rounded p-1">Status</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline bounded surface with cramped padding", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Panel = () => <div style={{ backgroundColor: "navy", padding: "6px" }}>Status</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts at least 8px of padding", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Panel = () => <><div className="border p-2">Status</div><div style={{ border: "1px solid", padding: 8 }}>Status</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer a visible boundary from transparent backgrounds", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Label = () => <div className="bg-transparent p-1" style={{ backgroundColor: "transparent", padding: 4 }}>Status</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when background utilities conflict at equal priority", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Labels = () => <><div className="bg-blue-500 bg-transparent p-1">Plain</div><div className="bg-transparent bg-blue-500 p-1">Surface</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine padding and boundaries from different variants", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Panel = () => <div className="p-1 dark:border">Status</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a one-sided divider as a container around text", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Cells = () => <><div className="border-r px-5 pt-0.5">Node pool</div><div className="border-r px-0"><div className="px-4 py-3">Member</div></div><div className="border border-r-0 p-1">Open edge</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores Tailwind utilities that do not draw a visible surface", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <>
        <div className="border-0 p-1">Zero border</div>
        <div className="border-none p-1">No border</div>
        <div className="border-transparent p-1">Transparent border color</div>
        <div className="border border-transparent p-1">Transparent border</div>
        <div className="border-spacing-2 p-1">Table spacing</div>
        <div className="ring-0 p-1">Zero ring</div>
        <div className="ring ring-transparent p-1">Transparent ring</div>
        <div className="bg-transparent p-1">Transparent background</div>
        <div className="bg-blue-500 bg-opacity-0 p-1">Transparent background color</div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still recognizes positive border and ring widths", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <><div className="border-2 p-1">Border</div><div className="ring-1 p-1">Ring</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("uses effective boundary resets and preserves variant scope", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <>
        <div className="border !border-0 p-1">Reset border</div>
        <div className="border-0 !border p-1">Restored border</div>
        <div className="ring ring-0 p-1">Reset ring</div>
        <div className="ring-0 ring p-1">Restored ring</div>
        <div className="border md:border-0 p-1">Responsive reset only</div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes physical, logical, and axis padding utilities", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <>
        <div className="border px-1">Horizontal</div>
        <div className="border py-1">Vertical</div>
        <div className="border pt-1">Top</div>
        <div className="border pr-1">Right</div>
        <div className="border pb-1">Bottom</div>
        <div className="border pl-1">Left</div>
        <div className="border ps-1">Start</div>
        <div className="border pe-[0.25rem]">End</div>
        <div className="border p-px">One pixel</div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(9);
  });

  it("uses the smallest declared base padding regardless of token order", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <><div className="border p-4 px-1">First</div><div className="border px-1 p-4">Second</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays quiet when equal-priority padding utilities conflict", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <><div className="border p-1 p-4">Normal conflict</div><div className="border !p-1 !p-4">Important conflict</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not retain a shorthand value overridden on every axis", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Example = () => <div className="border p-1 px-4 py-4">Roomy</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores zero-width inline boundaries", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <><div style={{ borderWidth: 0, padding: 4 }}>Zero</div><div style={{ border: "0", padding: 4 }}>None</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores non-drawing inline boundary shorthands", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <><div style={{ border: "0 solid red", padding: 4 }}>Zero border</div><div style={{ boxShadow: "0 0 0 transparent", padding: 4 }}>Transparent shadow</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses the last duplicate inline boundary and padding values", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <>
        <div style={{ backgroundColor: "navy", backgroundColor: "transparent", padding: 4 }}>No surface</div>
        <div style={{ backgroundColor: "navy", padding: 4, padding: 16 }}>Roomy</div>
        <div style={{ backgroundColor: "transparent", backgroundColor: "navy", padding: 16, padding: 4 }}>Cramped</div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves shorthand and longhand inline padding overrides by side", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <>
        <div style={{ backgroundColor: "navy", padding: 4, paddingTop: 12, paddingRight: 12, paddingBottom: 12, paddingLeft: 12 }}>Roomy</div>
        <div style={{ backgroundColor: "navy", padding: 4, paddingTop: 12 }}>Still cramped</div>
        <div className="border p-1" style={{ padding: 12 }}>Inline override</div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("respects authoritative inline boundary resets over Tailwind surfaces", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <><div className="border p-1" style={{ border: "none" }}>No border</div><div className="border p-1" style={{ borderColor: "transparent" }}>No border color</div><div className="border p-1" style={{ borderStyle: "none" }}>No border style</div><div className="bg-blue-500 p-1" style={{ backgroundColor: "transparent" }}>No fill</div><div className="ring p-1" style={{ boxShadow: "none" }}>No ring</div><div className="border bg-blue-500 p-1" style={{ backgroundColor: "transparent" }}>Border remains</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves related inline boundary declarations in source order", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <>
        <div className="border p-1" style={{ border: "1px solid", borderWidth: 0 }}>No border</div>
        <div className="border p-1" style={{ borderWidth: 0, border: "1px solid" }}>Restored border</div>
        <div className="bg-blue-500 p-1" style={{ background: "navy", backgroundColor: "transparent" }}>No fill</div>
        <div className="bg-blue-500 p-1" style={{ backgroundColor: "transparent", background: "navy" }}>Restored fill</div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("honors important boundary and padding precedence", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <>
        <div className="!border border-0 p-1">Border remains</div>
        <div className="!border-0 border p-1">Border stays reset</div>
        <div className="border !p-4 p-1">Roomy</div>
        <div className="border !p-1 p-4">Cramped</div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("merges important Tailwind boundaries and padding with inline styles", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <>
        <div className="bg-red-500 !p-0" style={{ padding: 16 }}>Important padding</div>
        <div className="!bg-transparent p-0" style={{ backgroundColor: "red" }}>Transparent</div>
        <div className="!bg-red-500 p-0" style={{ backgroundColor: "transparent" }}>Visible</div>
        <div className="bg-red-500 p-0" style={{ padding: 16 }}>Roomy</div>
        <div className="!border-0 p-0" style={{ border: "1px solid red" }}>No border</div>
        <div className="!border p-0" style={{ borderWidth: 0 }}>Border</div>
        <div className="!border-0 !border-red-500 p-0" style={{ border: "1px solid red" }}>Colored reset</div>
        <div className="!bg-transparent !bg-opacity-100 p-0" style={{ backgroundColor: "red" }}>Transparent color</div>
        <div className="!ring-0 !ring-red-500 p-0" style={{ boxShadow: "0 0 0 2px red" }}>Ring reset</div>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("stays quiet when a JSX spread can override class or style geometry", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = ({ props }) => <><div className="border p-1" {...props}>Class override</div><div style={{ backgroundColor: "navy", padding: 4 }} {...props}>Style override</div></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports geometry proven by an explicit style after a leading spread", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Example = ({ props }) => <div {...props} style={{ backgroundColor: "navy", padding: 4 }}>Status</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays conservative when a later spread can override inline geometry", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Example = ({ overrides }) => <div style={{ backgroundColor: "navy", padding: 4, ...overrides }}>Status</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores compact inline surfaces, controls, and opaque components", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <><span className="rounded bg-slate-200 px-2 py-1">Status</span><button className="rounded bg-blue-600 px-3 py-1.5">Save</button><Badge className="border p-1">New</Badge></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
