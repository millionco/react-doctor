import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCrampedContainerPadding } from "./no-cramped-container-padding.js";

describe("no-cramped-container-padding", () => {
  it("flags text in a bordered Tailwind container with 4px padding", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Badge = () => <span className="border rounded p-1">Status</span>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline bounded surface with cramped padding", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Badge = () => <span style={{ backgroundColor: "navy", padding: "6px" }}>Status</span>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts at least 8px of padding", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Badge = () => <><span className="border p-2">Status</span><span style={{ border: "1px solid", padding: 8 }}>Status</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer a visible boundary from transparent backgrounds", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Label = () => <span className="bg-transparent p-1" style={{ backgroundColor: "transparent", padding: 4 }}>Status</span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine padding and boundaries from different variants", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Badge = () => <span className="p-1 dark:border">Status</span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores Tailwind utilities that do not draw a visible surface", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <>
        <span className="border-0 p-1">Zero border</span>
        <span className="border-none p-1">No border</span>
        <span className="border-transparent p-1">Transparent border color</span>
        <span className="border border-transparent p-1">Transparent border</span>
        <span className="border-spacing-2 p-1">Table spacing</span>
        <span className="ring-0 p-1">Zero ring</span>
        <span className="ring ring-transparent p-1">Transparent ring</span>
        <span className="bg-transparent p-1">Transparent background</span>
        <span className="bg-blue-500 bg-opacity-0 p-1">Transparent background color</span>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still recognizes positive border and ring widths", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <><span className="border-2 p-1">Border</span><span className="ring-1 p-1">Ring</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("ignores zero-width inline boundaries", () => {
    const result = runRule(
      noCrampedContainerPadding,
      `const Examples = () => <><span style={{ borderWidth: 0, padding: 4 }}>Zero</span><span style={{ border: "0", padding: 4 }}>None</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
