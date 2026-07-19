import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTightBodyLeading } from "./no-tight-body-leading.js";

const LONG_TEXT =
  "This paragraph contains enough words to wrap across several lines in a typical content column.";

describe("no-tight-body-leading", () => {
  it("flags tight unitless leading on long body copy", () => {
    const result = runRule(
      noTightBodyLeading,
      `const Example = () => <p style={{ lineHeight: 1.2 }}>${LONG_TEXT}</p>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a tight Tailwind leading utility on body copy", () => {
    const result = runRule(
      noTightBodyLeading,
      `const Example = () => <p className="leading-tight">${LONG_TEXT}</p>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("computes pixel line height relative to font size", () => {
    const result = runRule(
      noTightBodyLeading,
      `const Example = () => <p style={{ fontSize: 16, lineHeight: "18px" }}>${LONG_TEXT}</p>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag comfortable leading", () => {
    const result = runRule(
      noTightBodyLeading,
      `const Example = () => <p style={{ lineHeight: 1.5 }}>${LONG_TEXT}</p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("treats every numeric line height as a unitless multiplier", () => {
    const result = runRule(
      noTightBodyLeading,
      `const Example = () => <><p style={{ fontSize: 16, lineHeight: 18 }}>${LONG_TEXT}</p><p style={{ fontSize: 16, lineHeight: "18" }}>${LONG_TEXT}</p></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses the last duplicate font size and line height values", () => {
    const result = runRule(
      noTightBodyLeading,
      `const Example = () => <>
        <p style={{ lineHeight: 1.1, lineHeight: 1.5 }}>${LONG_TEXT}</p>
        <p style={{ fontSize: 32, fontSize: 16, lineHeight: "18px" }}>${LONG_TEXT}</p>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays conservative when a later spread can override inline leading", () => {
    const result = runRule(
      noTightBodyLeading,
      `const Example = ({ overrides }) => <p style={{ lineHeight: 1.1, ...overrides }}>${LONG_TEXT}</p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat responsive tight leading as always active", () => {
    const result = runRule(
      noTightBodyLeading,
      `const Example = () => <p className="lg:leading-tight">${LONG_TEXT}</p>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag short labels or headings", () => {
    const result = runRule(
      noTightBodyLeading,
      `const Example = () => <><span className="leading-none">New</span><h1 style={{ lineHeight: 1.1 }}>${LONG_TEXT}</h1></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat display-size paragraph text as body copy", () => {
    const result = runRule(
      noTightBodyLeading,
      `const Example = () => <><p className="text-3xl leading-tight">${LONG_TEXT}</p><p style={{ fontSize: 32, lineHeight: 1.1 }}>${LONG_TEXT}</p></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
