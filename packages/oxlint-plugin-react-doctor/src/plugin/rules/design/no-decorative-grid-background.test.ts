import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDecorativeGridBackground } from "./no-decorative-grid-background.js";

const GRID_BACKGROUND =
  "linear-gradient(to right, #aaa 1px, transparent 1px), linear-gradient(to bottom, #aaa 1px, transparent 1px)";

describe("no-decorative-grid-background", () => {
  it("flags a two-axis grid with a fixed pixel tile", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <section style={{ backgroundImage: "${GRID_BACKGROUND}", backgroundSize: "24px" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags inverted hairlines when each shorthand layer declares its tile", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <section style={{ background: "linear-gradient(90deg, transparent calc(100% - 1px), #94a3b8 1px) 0 0 / 48px 48px, linear-gradient(transparent calc(100% - 1px), #94a3b8 1px) 0 0 / 48px 48px" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a single hairline tiled by a fixed pixel pair", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <section style={{ backgroundImage: "linear-gradient(90deg, #aaa 1px, transparent 1px)", backgroundSize: "40px 40px" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags vendor-prefixed hairline gradients", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <section style={{
        backgroundImage: "-webkit-linear-gradient(90deg, #aaa 1px, transparent 1px), -moz-linear-gradient(#aaa 1px, transparent 1px)",
        backgroundSize: "24px",
      }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags supported arbitrary utility grid spellings", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <>
        <section className="[background-image:linear-gradient(to_right,#aaa_1px,transparent_1px),linear-gradient(to_bottom,#aaa_1px,transparent_1px)] [background-size:24px]" />
        <section className="bg-[linear-gradient(90deg,#aaa_1px,transparent_1px)] bg-[length:40px_40px]" />
        <section className="[background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px]" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("resolves important Tailwind background utilities before reporting", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <>
        <section className="!bg-none [background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px]" />
        <section className="[background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px] !bg-none" />
        <section className="![background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px] bg-none" />
        <section className="bg-none ![background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px]" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays quiet when equal-priority or dynamic utilities make the background ambiguous", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <>
        <section className="bg-none [background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px]" />
        <section className="[background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px] bg-none" />
        <section className="bg-[var(--surface)] [background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px]" />
        <section className="[background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px] !bg-cover" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts gradients without fixed pixel grid evidence", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <>
        <section style={{ backgroundImage: "linear-gradient(to bottom, #fff, transparent)" }} />
        <section style={{ backgroundImage: "${GRID_BACKGROUND}" }} />
        <section style={{ backgroundImage: "linear-gradient(90deg, #aaa 1px, transparent 1px)", backgroundSize: "25% 100%" }} />
        <section style={{ backgroundImage: "${GRID_BACKGROUND}", backgroundSize: "2rem 2rem" }} />
        <section className="[background-image:linear-gradient(90deg,#aaa_1px,transparent_1px)] [background-size:25%_100%]" />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a grid inside a chart component", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Plot = () => <ChartCanvas style={{ backgroundImage: "${GRID_BACKGROUND}", backgroundSize: "24px" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a grid nested inside a chart surface", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Plot = () => <section className="chart"><div style={{ backgroundImage: "${GRID_BACKGROUND}", backgroundSize: "24px" }} /></section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not mistake typography class names for graph context", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <section className="typography" style={{ backgroundImage: "${GRID_BACKGROUND}", backgroundSize: "24px" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts non-grid, repeating, diagonal, and same-axis gradients", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <>
        <section style={{ backgroundImage: "linear-gradient(#fff 1px, #ddd 1px), linear-gradient(90deg, #fff 1px, #ddd 1px)", backgroundSize: "24px" }} />
        <section style={{ backgroundImage: "repeating-linear-gradient(90deg, #aaa 0 1px, transparent 1px 24px), repeating-linear-gradient(#aaa 0 1px, transparent 1px 24px)", backgroundSize: "24px" }} />
        <section style={{ backgroundImage: "linear-gradient(45deg, #aaa 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
        <section style={{ backgroundImage: "linear-gradient(90deg, #aaa 1px, transparent 1px), linear-gradient(to right, #bbb 1px, transparent 1px)", backgroundSize: "24px" }} />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for dynamic or overridden values", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Dynamic = ({ backgroundImage, className, style }) => <>
        <section style={{ backgroundImage, backgroundSize: "24px 24px" }} />
        <section className={className} />
        <section className="[background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px]" style={style} />
        <section className="[background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px]" style={{ backgroundImage: "url(hero.png)" }} />
        <section className="[background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px]" {...style} />
        <section style={{ backgroundImage: "linear-gradient(90deg, #aaa 1px, transparent 1px)", backgroundSize: "40px 40px", background: "url(hero.png)" }} />
        <section style={{ background: "linear-gradient(90deg, #aaa 1px, transparent 1px) 0 0 / 40px 40px", backgroundSize: "cover" }} />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("respects the final inline background property order", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <section style={{ background: "url(hero.png)", backgroundImage: "linear-gradient(90deg, #aaa 1px, transparent 1px)", backgroundSize: "40px 40px" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("checks className when inline style only sets background size", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <section
        className="[background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px]"
        style={{ backgroundSize: "40px 40px" }}
      />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("respects inline background-size overrides for class grids", () => {
    const result = runRule(
      noDecorativeGridBackground,
      `const Hero = () => <section
        className="[background:linear-gradient(90deg,#aaa_1px,transparent_1px)_0_0/40px_40px]"
        style={{ backgroundSize: "cover" }}
      />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
