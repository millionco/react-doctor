import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLongTransitionDuration } from "./no-long-transition-duration.js";

describe("no-long-transition-duration", () => {
  it("flags a finite long transition", () => {
    const result = runRule(
      noLongTransitionDuration,
      `const S = () => <div style={{ transition: "width 2s ease" }} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a finite long one-shot animation", () => {
    const result = runRule(
      noLongTransitionDuration,
      `const S = () => <div style={{ animation: "slide 2s ease-out" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a short transition", () => {
    const result = runRule(
      noLongTransitionDuration,
      `const S = () => <div style={{ transition: "opacity 0.2s" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  // A looping animation is a background loop, not a transition the user
  // waits through, so a long duration is fine.
  it("does not flag a looping animation with the `infinite` keyword", () => {
    const result = runRule(
      noLongTransitionDuration,
      `const S = () => <div style={{ animation: "pulse 2s ease-in-out infinite" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag animationDuration with a sibling infinite iteration count", () => {
    const stringCount = runRule(
      noLongTransitionDuration,
      `const S = () => <div style={{ animationDuration: "2s", animationIterationCount: "infinite" }} />;`,
    );
    const infinityCount = runRule(
      noLongTransitionDuration,
      `const S = () => <div style={{ animationDuration: "2s", animationIterationCount: Infinity }} />;`,
    );
    expect(stringCount.diagnostics).toHaveLength(0);
    expect(infinityCount.diagnostics).toHaveLength(0);
  });
});
