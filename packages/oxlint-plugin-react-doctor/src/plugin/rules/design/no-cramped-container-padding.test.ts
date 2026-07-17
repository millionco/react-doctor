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
});
