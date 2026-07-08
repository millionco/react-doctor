import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPermanentWillChange } from "./no-permanent-will-change.js";

const run = (code: string) => runRule(noPermanentWillChange, code, { filename: "fixture.tsx" });

describe("performance/no-permanent-will-change — regressions", () => {
  it("flags a static willChange value", () => {
    const result = run(`const S = () => <div style={{ willChange: "transform" }} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a ternary scoped to the active animation", () => {
    const result = run(
      `const Ball = ({ isDragging, x, y }) => (
        <div style={{ transform: \`translate3d(\${x}px, \${y}px, 0)\`, willChange: isDragging ? "transform" : "auto" }} />
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a logical expression scoped to the active animation", () => {
    const result = run(
      `const S = ({ isAnimating }) => <div style={{ willChange: isAnimating && "transform" }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag willChange: scroll-position on a scroll container", () => {
    const result = run(
      `const Viewport = () => (
        <div style={{ overflowY: "auto", willChange: "scroll-position" }} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a static compound value listing transform", () => {
    const result = run(`const S = () => <div style={{ willChange: "transform, opacity" }} />;`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
