import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLowContrastInlineStyle } from "./no-low-contrast-inline-style.js";

describe("no-low-contrast-inline-style", () => {
  it("flags gray-400 text on white at normal size (≈2.5:1 < 4.5)", () => {
    const code = `const A = () => <span style={{ color: "#9ca3af", backgroundColor: "#ffffff", fontSize: 16 }}>Balance</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("4.5:1");
  });

  it("flags gray-400 on white even when size is unknown (fails the 3:1 floor too)", () => {
    const code = `const A = () => <span style={{ color: "#9ca3af", backgroundColor: "#ffffff" }}>Balance</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("3:1");
  });

  it("flags near-invisible white-on-light text", () => {
    const code = `const A = () => <div style={{ color: "white", backgroundColor: "#f3f4f6" }}>Saved</div>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags #808080 on white at an explicit normal size (≈3.95:1 < 4.5)", () => {
    const code = `const A = () => <p style={{ color: "#808080", backgroundColor: "#fff", fontSize: 14 }}>body</p>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag #808080 on white at large size (≈3.95:1 ≥ 3 large threshold)", () => {
    const code = `const A = () => <h1 style={{ color: "#808080", backgroundColor: "#fff", fontSize: 32 }}>Title</h1>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a 3–4.5 band pair when size is unknown (could be large text via a class)", () => {
    const code = `const A = () => <h1 className="text-5xl" style={{ color: "#808080", backgroundColor: "#fff" }}>Title</h1>;`;
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

  it("does NOT flag when a `background` shorthand gradient/image is present", () => {
    const code = `const A = () => <span style={{ color: "#999999", background: "linear-gradient(#000,#fff)" }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("DOES flag a solid `background` shorthand color (Bugbot: background shorthand skips contrast)", () => {
    const code = `const A = () => <span style={{ color: "#9ca3af", background: "#ffffff", fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag when both backgroundColor and background shorthand are present (ambiguous)", () => {
    const code = `const A = () => <span style={{ color: "#9ca3af", backgroundColor: "#fff", background: "#000", fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a static background overridden by dynamic backgroundColor", () => {
    const code = `const A = ({ surfaceColor }) => <span style={{ color: "#9ca3af", background: "#fff", backgroundColor: surfaceColor, fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a static color overridden by a dynamic color", () => {
    const code = `const A = ({ textColor }) => <span style={{ color: "#9ca3af", color: textColor, backgroundColor: "#fff", fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a dynamic color overridden by a later static color", () => {
    const code = `const A = ({ textColor }) => <span style={{ color: textColor, color: "#9ca3af", backgroundColor: "#fff", fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a dynamic backgroundColor overridden by a later static backgroundColor", () => {
    const code = `const A = ({ surfaceColor }) => <span style={{ color: "#9ca3af", backgroundColor: surfaceColor, backgroundColor: "#fff", fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a dynamic background overridden by a later static background", () => {
    const code = `const A = ({ surface }) => <span style={{ color: "#9ca3af", background: surface, background: "#fff", fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag an unknown font weight in the bold-large size band", () => {
    const code = `const A = ({ fontWeight }) => <span style={{ color: "#808080", backgroundColor: "#fff", fontSize: 20, fontWeight }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags explicit regular text in the bold-large size band", () => {
    const code = `const A = () => <span style={{ color: "#808080", backgroundColor: "#fff", fontSize: 20, fontWeight: "normal" }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still evaluates contrast when backgroundImage is explicitly none", () => {
    const code = `const A = () => <span style={{ color: "#9ca3af", backgroundColor: "#fff", backgroundImage: "none", fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag large + string `fontWeight: '700'` (Bugbot: string weight ignored)", () => {
    const code = `const A = () => <span style={{ color: "#808080", backgroundColor: "#fff", fontSize: 20, fontWeight: "700" }}>x</span>;`;
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

  it("does NOT flag 4-arg `rgb(0,0,0,0.5)` (carries alpha)", () => {
    const code = `const A = () => <span style={{ color: "rgb(0,0,0,0.5)", backgroundColor: "#ffffff" }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("DOES flag opaque comma `rgb()` colors", () => {
    const code = `const A = () => <span style={{ color: "rgb(156,163,175)", backgroundColor: "rgb(255,255,255)", fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags low-contrast opaque hsl colors", () => {
    const code = `const A = () => <span style={{ color: "hsl(220 9% 65%)", backgroundColor: "hsl(0 0% 100%)", fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag accessible opaque hsl colors", () => {
    const code = `const A = () => <span style={{ color: "hsl(215, 28%, 17%)", backgroundColor: "hsl(0, 0%, 100%)", fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag hsl colors carrying alpha", () => {
    const code = `const A = () => <span style={{ color: "hsl(220 9% 65% / 40%)", backgroundColor: "hsl(0 0% 100%)", fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag legacy hsla colors", () => {
    const code = `const A = () => <span style={{ color: "hsla(220, 9%, 65%, 0.4)", backgroundColor: "hsl(0, 0%, 100%)", fontSize: 16 }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag when the style object has a spread (could override colors)", () => {
    const code = `const A = (rest) => <span style={{ color: "#9ca3af", backgroundColor: "#fff", ...rest }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag when a computed property could override colors", () => {
    const code = `const A = ({ propertyName, value }) => <span style={{ color: "#9ca3af", backgroundColor: "#fff", fontSize: 16, [propertyName]: value }}>x</span>;`;
    const result = runRule(noLowContrastInlineStyle, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
