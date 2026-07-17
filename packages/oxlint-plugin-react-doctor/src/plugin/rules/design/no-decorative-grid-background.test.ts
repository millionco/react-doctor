import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDecorativeGridBackground } from "./no-decorative-grid-background.js";

const GRID_BACKGROUND =
  "linear-gradient(to right, #aaa 1px, transparent 1px), linear-gradient(to bottom, #aaa 1px, transparent 1px)";

describe("no-decorative-grid-background", () => {
  it("flags a layered one-pixel grid background", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <section style={{ backgroundImage: "${GRID_BACKGROUND}" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an arbitrary utility grid background", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <section className="[background-image:linear-gradient(to_right,#aaa_1px,transparent_1px),linear-gradient(to_bottom,#aaa_1px,transparent_1px)]" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a single gradient", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <section style={{ backgroundImage: "linear-gradient(to bottom, #fff, transparent)" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a grid inside a chart component", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Plot = () => <ChartCanvas style={{ backgroundImage: "${GRID_BACKGROUND}" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a grid nested inside a chart surface", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Plot = () => <section className="chart"><div style={{ backgroundImage: "${GRID_BACKGROUND}" }} /></section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not mistake typography class names for graph context", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <section className="typography" style={{ backgroundImage: "${GRID_BACKGROUND}" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
