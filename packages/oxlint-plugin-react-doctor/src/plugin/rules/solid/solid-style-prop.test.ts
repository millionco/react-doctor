import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { solidStyleProp } from "./solid-style-prop.js";

describe("solid-style-prop", () => {
  it("flags camelCase CSS property name", () => {
    const result = runRule(
      solidStyleProp,
      `const Foo = () => <div style={{ fontSize: "16px" }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("font-size");
    expect(result.diagnostics[0].message).toContain("kebab-case");
  });

  it("flags numeric value on length property", () => {
    const result = runRule(solidStyleProp, `const Foo = () => <div style={{ width: 100 }} />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("unit");
  });

  it("does not flag numeric zero on length property", () => {
    const result = runRule(solidStyleProp, `const Foo = () => <div style={{ width: 0 }} />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags string style prop value", () => {
    const result = runRule(solidStyleProp, `const Foo = () => <div style="color: red" />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("object");
  });

  it("flags template literal style prop value", () => {
    const result = runRule(solidStyleProp, "const Foo = () => <div style={`color: ${c}`} />;");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("object");
  });

  it("does not flag kebab-case property names", () => {
    const result = runRule(
      solidStyleProp,
      `const Foo = () => <div style={{ "font-size": "16px" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag CSS custom properties", () => {
    const result = runRule(
      solidStyleProp,
      `const Foo = () => <div style={{ "--myColor": "red" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag string values on length properties", () => {
    const result = runRule(solidStyleProp, `const Foo = () => <div style={{ width: "100px" }} />;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags multiple camelCase properties", () => {
    const result = runRule(
      solidStyleProp,
      `const Foo = () => <div style={{ backgroundColor: "red", marginTop: "10px" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not flag non-style props", () => {
    const result = runRule(
      solidStyleProp,
      `const Foo = () => <div data-style={{ fontSize: "16px" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags invalid CSS property name", () => {
    const result = runRule(
      solidStyleProp,
      `const Foo = () => <div style={{ "not-a-prop": "value" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("not a valid CSS property");
  });

  it("does not flag valid CSS property", () => {
    const result = runRule(
      solidStyleProp,
      `const Foo = () => <div style={{ "background-color": "red" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag CSS custom property", () => {
    const result = runRule(
      solidStyleProp,
      `const Foo = () => <div style={{ "--my-var": "10px" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag vendor-prefixed property", () => {
    const result = runRule(
      solidStyleProp,
      `const Foo = () => <div style={{ "-webkit-transform": "rotate(45deg)" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
