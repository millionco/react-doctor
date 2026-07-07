import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLongTransitionDuration } from "./no-long-transition-duration.js";

const run = (code: string) => runRule(noLongTransitionDuration, code, { filename: "fixture.tsx" });

describe("design/no-long-transition-duration — regressions", () => {
  // Mined FP (ant-design LuminousBg): a decorative aria-hidden background
  // bubble drifting via a 5s transition — ambient scenery, not a state
  // change the user waits through.
  it("does not flag a long transition on a decorative aria-hidden element", () => {
    const result = run(
      `const Bubble = ({ opacity, size, color, left, top, offset, sizeOffset }) => (
        <div
          aria-hidden="true"
          style={{
            opacity,
            width: size,
            height: size,
            borderRadius: '50%',
            background: color,
            filter: 'blur(100px)',
            left,
            top,
            transform: \`translate(-50%, -50%) translate(\${offset[0]}px, \${offset[1]}px) scale(\${sizeOffset})\`,
            transition: 'all 5s ease-in-out',
            position: 'absolute',
          }}
        />
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags the long finite animation in a shorthand that also lists an infinite one", () => {
    const result = run(
      `const S = () => <div style={{ animation: "slide 3s ease-out, pulse 1s linear infinite" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a long one-shot animation whose NAME contains 'infinite'", () => {
    const result = run(`const S = () => <div style={{ animation: "infinite-scroll 3s ease" }} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a long transition despite an unrelated infinite animation sibling", () => {
    const result = run(
      `const S = () => <div style={{ transition: "opacity 2s", animationIterationCount: "infinite" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag animationDuration tuning a Tailwind animate-ping loop", () => {
    const result = run(
      `const S = () => (
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full"
          style={{ animationDuration: '2s', animationDelay: '0.5s' }}
        />
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a one-shot `forwards` animation (auto-dismiss countdown)", () => {
    const result = run(
      `const S = () => <div style={{ animation: 'shrink 8s linear forwards' }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a `forwards` status fade shorthand", () => {
    const result = run(
      `const S = () => <div style={{ animation: 'thinking-phase-done 2.5s ease-out forwards' }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a long one-shot animation without forwards or infinite", () => {
    const result = run(`const S = () => <div style={{ animation: 'slide 3s ease-out' }} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a long transition next to an animate-ping className", () => {
    const result = run(
      `const S = () => <div className="animate-ping" style={{ transition: 'opacity 2s' }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a long animationDuration without any loop signal", () => {
    const result = run(
      `const S = () => <div className="rounded-full" style={{ animationDuration: '2s' }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
