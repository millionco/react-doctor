import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLayoutTransitionInline } from "./no-layout-transition-inline.js";

describe("no-layout-transition-inline", () => {
  it("flags a transition on `width`", () => {
    const result = runRule(
      noLayoutTransitionInline,
      `const I = () => <div style={{ transition: "width 0.3s" }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a transition on `margin`", () => {
    const result = runRule(
      noLayoutTransitionInline,
      `const I = () => <div style={{ transition: "margin 0.2s" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a transition on `max-height`", () => {
    const result = runRule(
      noLayoutTransitionInline,
      `const I = () => <div style={{ transition: "max-height 0.2s" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // `stroke-width` is an SVG paint property, not a layout property — the
  // `width` token is only the hyphenated tail and must not match.
  it("does not flag a transition on `stroke-width`", () => {
    const result = runRule(
      noLayoutTransitionInline,
      `const I = () => <svg style={{ transition: "stroke-width 0.2s" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a transition on `transform`", () => {
    const result = runRule(
      noLayoutTransitionInline,
      `const I = () => <div style={{ transition: "transform 0.2s" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
