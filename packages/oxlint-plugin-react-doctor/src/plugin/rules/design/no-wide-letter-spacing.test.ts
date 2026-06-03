import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noWideLetterSpacing } from "./no-wide-letter-spacing.js";

describe("no-wide-letter-spacing", () => {
  it("flags wide letter spacing on body text", () => {
    const code = `
      const Body = () => (
        <p style={{ letterSpacing: 2 }}>Some long paragraph of body copy.</p>
      );
    `;
    const result = runRule(noWideLetterSpacing, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("letter spacing");
  });

  it("does NOT flag when inline textTransform uppercase is present", () => {
    const code = `
      const Label = () => (
        <span style={{ letterSpacing: 2, textTransform: "uppercase" }}>NEW</span>
      );
    `;
    const result = runRule(noWideLetterSpacing, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag when a sibling boolean `uppercase` prop is present", () => {
    // The uppercase transform lives inside the wrapper component, applied
    // by its `uppercase` prop, so the rule can't see it in the style object
    // (satsigner#671). The sibling prop is the visible signal.
    const code = `
      const Label = () => (
        <SSText uppercase style={{ letterSpacing: 2 }}>LABEL</SSText>
      );
    `;
    const result = runRule(noWideLetterSpacing, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag when a sibling `uppercase={true}` prop is present", () => {
    const code = `
      const Label = () => (
        <SSText uppercase={true} style={{ letterSpacing: 2 }}>LABEL</SSText>
      );
    `;
    const result = runRule(noWideLetterSpacing, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does NOT flag when a sibling `textTransform="uppercase"` prop is present', () => {
    const code = `
      const Label = () => (
        <Text textTransform="uppercase" style={{ letterSpacing: 2 }}>LABEL</Text>
      );
    `;
    const result = runRule(noWideLetterSpacing, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when a sibling `uppercase={false}` prop is present", () => {
    const code = `
      const Body = () => (
        <SSText uppercase={false} style={{ letterSpacing: 2 }}>body copy</SSText>
      );
    `;
    const result = runRule(noWideLetterSpacing, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag letter spacing within the readable threshold", () => {
    const code = `
      const Body = () => (
        <p style={{ letterSpacing: 0.5 }}>Some long paragraph of body copy.</p>
      );
    `;
    const result = runRule(noWideLetterSpacing, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
