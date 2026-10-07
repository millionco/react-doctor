import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noOutlineNone } from "./no-outline-none.js";

describe("no-outline-none", () => {
  it("flags a focusable element with outline:none and no replacement ring", () => {
    const result = runRule(
      noOutlineNone,
      `const T = () => <button style={{ outline: "none" }}>Save</button>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an element with a non-negative tabIndex", () => {
    const result = runRule(
      noOutlineNone,
      `const T = () => <div tabIndex={0} style={{ outline: "none" }}>x</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag when a box-shadow focus ring replaces the outline", () => {
    const result = runRule(
      noOutlineNone,
      `const T = () => <button style={{ outline: "none", boxShadow: "0 0 0 2px blue" }}>Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat arbitrary-value fragments as a replacement focus ring", () => {
    const result = runRule(
      noOutlineNone,
      `const T = () => <button className="[--focus:x focus:ring-2 fallback]" style={{ outline: "none" }}>Save</button>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // A negative tabIndex removes the element from the tab order, so it's
  // never keyboard-focused and dropping the focus ring is fine.
  it("does not flag an element with a negative tabIndex", () => {
    const result = runRule(
      noOutlineNone,
      `const T = ({ children }) => <div tabIndex={-1} style={{ outline: "none" }}>{children}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
