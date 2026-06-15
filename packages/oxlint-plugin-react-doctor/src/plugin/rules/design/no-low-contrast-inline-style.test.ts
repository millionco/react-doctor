import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLowContrastInlineStyle } from "./no-low-contrast-inline-style.js";

describe("no-low-contrast-inline-style", () => {
  it("flags gray-400 text on white (≈2.5:1)", () => {
    const code = `const A = () => <span style={{ color: "#9ca3af", backgroundColor: "#ffffff" }}>Balance</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("4.5:1");
  });

  it("flags near-invisible white-on-light text", () => {
    const code = `const A = () => <div style={{ color: "white", backgroundColor: "#f3f4f6" }}>Saved</div>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags #808080 on white at normal size (≈3.95:1 < 4.5)", () => {
    const code = `const A = () => <p style={{ color: "#808080", backgroundColor: "#fff" }}>body</p>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag #808080 on white at large size (≈3.95:1 ≥ 3 large threshold)", () => {
    const code = `const A = () => <h1 style={{ color: "#808080", backgroundColor: "#fff", fontSize: 32 }}>Title</h1>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag accessible gray-700 on white", () => {
    const code = `const A = () => <span style={{ color: "#374151", backgroundColor: "#ffffff" }}>OK</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag when only color is set (background unknown)", () => {
    const code = `const A = () => <span style={{ color: "#9ca3af" }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag when background is transparent", () => {
    const code = `const A = () => <span style={{ color: "#9ca3af", backgroundColor: "transparent" }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag when a `background` shorthand (possible gradient/image) is present", () => {
    const code = `const A = () => <span style={{ color: "#999999", background: "linear-gradient(#000,#fff)" }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag CSS-variable colors (unresolvable)", () => {
    const code = `const A = () => <span style={{ color: "var(--muted)", backgroundColor: "var(--card)" }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag colors carrying alpha (can't composite)", () => {
    const code = `const A = () => <span style={{ color: "rgba(0,0,0,0.4)", backgroundColor: "#ffffff" }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
