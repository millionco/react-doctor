import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { styledComponentsDuplicateCssPropertyInBlock } from "./styled-components-duplicate-css-property-in-block.js";

const rule = styledComponentsDuplicateCssPropertyInBlock;

describe("styled-components-duplicate-css-property-in-block", () => {
  it("flags a property declared twice as conditionals at the same level", () => {
    const result = runRule(
      rule,
      "const B = styled.div`padding-bottom: ${p => p.$isLayoutVariant ? '8px' : '0'}; padding-bottom: ${p => p.$isCtaVariant ? '4px' : '16px'};`;",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags duplicates inside a css block", () => {
    const result = runRule(
      rule,
      "const shared = css`opacity: ${p => p.$a ? 1 : 0}; opacity: ${p => p.$b ? 1 : 0.5};`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a block-body return ternary duplicate", () => {
    const result = runRule(
      rule,
      "const B = styled.div`margin: ${p => { return p.$a ? '8px' : '0'; }}; margin: ${p => p.$b ? '4px' : '0'};`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Prettier-formatted paren-wrapped ternary arrow bodies", () => {
    const result = runRule(
      rule,
      'const B = styled.div`padding-bottom: ${(p) => (p.$isLayoutVariant ? "8px" : "0")}; padding-bottom: ${(p) => (p.$isCtaVariant ? "4px" : "16px")};`;',
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a duplicate whose last declaration omits the optional trailing semicolon", () => {
    const result = runRule(
      rule,
      "const B = styled.div`opacity: ${p => p.$a ? 1 : 0}; opacity: ${p => p.$b ? 1 : 0.5}`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a layered computed + conditional pair", () => {
    const result = runRule(
      rule,
      "const B = styled.div`opacity: ${p => getComputedOpacity(p)}; opacity: ${p => p.$isHidden ? 0 : 'inherit'};`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the same property in a nested pseudo-selector", () => {
    const result = runRule(
      rule,
      "const B = styled.div`padding-bottom: ${p => p.$a ? '8px' : '0'}; &:hover { padding-bottom: ${p => p.$b ? '4px' : '0'}; }`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the same property in distinct @media blocks", () => {
    const result = runRule(
      rule,
      "const B = styled.div`padding-bottom: ${p => p.$a ? '8px' : '0'}; @media (min-width: 700px) { padding-bottom: ${p => p.$b ? '4px' : '0'}; }`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag shorthand versus longhand", () => {
    const result = runRule(
      rule,
      "const B = styled.div`padding: ${p => p.$a ? '8px' : '0'}; padding-bottom: ${p => p.$b ? '4px' : '0'};`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag reassigned custom properties", () => {
    const result = runRule(
      rule,
      "const B = styled.div`--gap: ${p => p.$a ? '8px' : '0'}; --gap: ${p => p.$b ? '4px' : '0'};`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag two static duplicate declarations", () => {
    const result = runRule(rule, "const B = styled.div`color: red; color: blue;`;");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a single declaration", () => {
    const result = runRule(
      rule,
      "const B = styled.div`padding-bottom: ${p => p.$a ? '8px' : '0'};`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a non-styled template tag", () => {
    const result = runRule(
      rule,
      "const q = other`color: ${p => p.$a ? 'x' : 'y'}; color: ${p => p.$b ? 'x' : 'y'};`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the dvh-with-vh-fallback under one condition", () => {
    const result = runRule(
      styledComponentsDuplicateCssPropertyInBlock,
      "const Modal = styled.div`\n" +
        '  height: ${(p) => (p.$fullHeight ? "100vh" : "auto")};\n' +
        '  height: ${(p) => (p.$fullHeight ? "100dvh" : "auto")};\n' +
        "`;",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a vendor-value fallback pair under one condition", () => {
    const result = runRule(
      styledComponentsDuplicateCssPropertyInBlock,
      "const Row = styled.div`\n" +
        '  width: ${(p) => (p.$stretch ? "-webkit-fill-available" : "auto")};\n' +
        '  width: ${(p) => (p.$stretch ? "fill-available" : "auto")};\n' +
        "`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags duplicates with different conditions (lost value)", () => {
    const result = runRule(
      styledComponentsDuplicateCssPropertyInBlock,
      "const Button = styled.button`\n" +
        '  color: ${(p) => (p.$primary ? "blue" : "gray")};\n' +
        '  color: ${(p) => (p.$danger ? "red" : "black")};\n' +
        "`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
