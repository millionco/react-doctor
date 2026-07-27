import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noShapeAssembledIllustration } from "./no-shape-assembled-illustration.js";

const primitiveShapes = `
  <rect fill="#8ecae6" />
  <rect fill="#219ebc" />
  <circle fill="#ffffff" />
  <circle fill="#023047" />
  <ellipse fill="#ffb703" />
  <polygon fill="#fb8500" />
  <rect fill="#219ebc" />
  <circle fill="#023047" />
`;

describe("no-shape-assembled-illustration", () => {
  it("flags a large multi-fill scene at the exact thresholds", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const HeroArt = () => <svg width={200 as const} height={200} viewBox="0 0 640 480">${primitiveShapes}</svg>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.nodeType).toBe("JSXOpeningElement");
    expect(result.diagnostics[0]?.message).toContain("8 basic shapes");
  });

  it("accepts static numeric JSX dimensions and inline style fills", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const HeroArt = () => <svg width={320} height={"240"}>
        <rect style={{ fill: "#111" }} /><circle style={{ fill: "#111" }} />
        <ellipse style={{ fill: "#111" }} /><rect style={{ fill: "#777" }} />
        <circle style={{ fill: "#777" }} /><ellipse style={{ fill: "#777" }} />
        <rect style={{ fill: "#fff" }} /><polygon style={{ fill: "#fff" }} />
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves static style bindings for SVG state and primitive fills", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const svgStyle = { display: "block" };
      const visibleStyle = { opacity: 1 };
      const darkFill = { fill: "#111" };
      const middleFill = { fill: "#777" };
      const lightFill = { fill: "#fff" };
      const HeroArt = () => <svg width={320} height={240} style={svgStyle}>
        <g style={visibleStyle}>
          <rect style={darkFill} /><circle style={darkFill} />
          <ellipse style={darkFill} /><rect style={middleFill} />
          <circle style={middleFill} /><ellipse style={middleFill} />
          <rect style={lightFill} /><polygon style={lightFill} />
        </g>
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("counts neutral static paints without requiring chroma", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const MonochromeScene = () => <svg width="400px" height="300px" viewBox="0, 0, 400, 300">
        <rect fill="black" /><rect fill="white" /><rect fill="#777" />
        <circle fill="black" /><circle fill="white" /><circle fill="#777" />
        <ellipse fill="black" /><polygon fill="white" />
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows small explicit dimensions even with a large viewBox", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Logo = () => <svg width="32" height="32" viewBox="0 0 400 400">${primitiveShapes}</svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat viewBox coordinate units as rendered pixels", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const ResponsiveGraphic = () => <svg viewBox="0 0 1200 800">${primitiveShapes}</svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows CSS that overrides large intrinsic dimensions with a small rendered box", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Logos = () => <>
        <svg width="400" height="400" style={{ width: 32, height: 32 }}>${primitiveShapes}</svg>
        <svg width="400" height="400" className="size-8">${primitiveShapes}</svg>
        <svg width="400" height="400" className="[max-width:48px]">${primitiveShapes}</svg>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows dimensions with unresolved runtime values", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Art = ({ size, dimensions }) => <>
        <svg width={size} height={size} viewBox="0 0 400 400">${primitiveShapes}</svg>
        <svg width="100%" height="400" viewBox="0 0 400 400">${primitiveShapes}</svg>
        <svg width="400" viewBox="0 0 400 400">${primitiveShapes}</svg>
        <svg {...dimensions} viewBox="0 0 400 400">${primitiveShapes}</svg>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows missing rendered dimensions regardless of viewBox syntax", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Art = ({ viewBox }) => <>
        <svg viewBox={viewBox}>${primitiveShapes}</svg>
        <svg viewBox="0 0 400">${primitiveShapes}</svg>
        <svg viewBox="0 0 -400 300">${primitiveShapes}</svg>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires at least eight supported primitives", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Drawing = () => <svg width="600" height="400" viewBox="0 0 600 400">
        <path fill="#111" /><path fill="#222" />
        <rect fill="#333" /><circle fill="#444" /><ellipse fill="#555" />
        <polygon fill="#666" /><rect fill="#777" /><circle fill="#888" />
        <path fill="#999" />
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires three distinct static paint fills", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Drawing = ({ color }) => <>
        <svg width="600" height="400" viewBox="0 0 600 400">
          <rect fill="#111" /><rect fill="#111" /><circle fill="#111" /><circle fill="#111" />
          <ellipse fill="#222" /><ellipse fill="#222" /><polygon fill="#222" /><polygon fill="#222" />
        </svg>
        <svg width="600" height="400" viewBox="0 0 600 400">
          <rect fill={color} /><rect fill={color} /><circle fill={color} /><circle fill={color} />
          <ellipse fill={color} /><ellipse fill={color} /><polygon fill={color} /><polygon fill={color} />
        </svg>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count non-paint or context-dependent fill values", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Drawing = () => <svg width="600" height="400" viewBox="0 0 600 400">
        <rect fill="none" /><rect fill="transparent" /><circle fill="currentColor" />
        <circle fill="inherit" /><ellipse fill="var(--paint)" /><ellipse fill="context-fill" />
        <polygon fill="#111" /><polygon fill="#222" />
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows charts and annotated diagrams with more than two text nodes", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Chart = () => <svg width="600" height="400" viewBox="0 0 600 400">
        ${primitiveShapes}
        <text>Q1</text><text>Q2</text><text><tspan>Q3</tspan></text>
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags an illustration with at most two text nodes", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Scene = () => <svg width="600" height="400" viewBox="0 0 600 400">
        ${primitiveShapes}
        <text>Hello</text><tspan>world</tspan>
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows SVG textures with pattern definitions", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Texture = () => <svg width="1200" height="600" viewBox="0 0 1200 600">
        <defs><pattern id="tile"><rect fill="#eee" /></pattern></defs>
        ${primitiveShapes}
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows stroke-only technical drawings", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Diagram = () => <svg width="600" height="400" viewBox="0 0 600 400" fill="none" stroke="currentColor">
        <circle /><circle /><ellipse /><rect /><rect /><rect /><polygon /><polygon />
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("bails on custom components and unresolved child expressions", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Art = ({ shapes }) => <>
        <Svg width="600" height="400">${primitiveShapes}</Svg>
        <svg width="600" height="400">${primitiveShapes}{shapes.map(shape => <rect {...shape} />)}</svg>
        <svg width="600" height="400">${primitiveShapes}<Shape /></svg>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("bails on unresolved non-empty expressions even with enough static evidence", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Art = ({ extra }) => <svg width="600" height="400">
        ${primitiveShapes}
        {extra}
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("bails when dynamic rendering state can hide the static shapes", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Art = ({ opacity, hidden }) => <svg width="600" height="400">
        <g style={{ opacity }}>${primitiveShapes}</g>
        <g hidden={hidden}>${primitiveShapes}</g>
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows statically empty expression children", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Art = () => <svg width="600" height="400">
        {/* layout marker */}{false}{null}{""}
        ${primitiveShapes}
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("excludes definition and clipping subtrees from primitive evidence", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Definitions = () => <svg width="600" height="400">
        <defs>${primitiveShapes}</defs>
        <symbol>${primitiveShapes}</symbol>
        <mask>${primitiveShapes}</mask>
        <clipPath>${primitiveShapes}</clipPath>
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("excludes statically hidden subtrees", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const HiddenShapes = () => <svg width="600" height="400">
        <g hidden>${primitiveShapes}</g>
        <g display="none">${primitiveShapes}</g>
        <g style={{ visibility: "hidden" }}>${primitiveShapes}</g>
        <g className="hidden">${primitiveShapes}</g>
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count inherited group fills or unrelated filled paths", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Drawing = () => <svg width="600" height="400">
        <g fill="#111"><rect /><circle /><ellipse /></g>
        <g fill="#777"><rect /><circle /><ellipse /></g>
        <g fill="#fff"><rect /><polygon /></g>
        <path fill="#f00" /><path fill="#0f0" /><path fill="#00f" />
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("canonicalizes equivalent color spellings before counting distinct fills", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Drawing = () => <svg width="600" height="400">
        <rect fill="white" /><circle fill="#fff" /><ellipse fill="#ffffff" />
        <polygon fill="rgb(255, 255, 255)" /><rect fill="black" />
        <circle fill="#000" /><ellipse fill="#000000" /><polygon fill="rgb(0 0 0)" />
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects invalid and fully transparent paint values", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Drawing = () => <svg width="600" height="400">
        <rect fill="not-a-color" /><circle fill="#xyz" /><ellipse fill="rgb(999, 0, 0)" />
        <polygon fill="rgba(255, 0, 0, 0)" /><rect fill="#111" />
        <circle fill="#222" /><ellipse fill="#333" /><polygon fill="#444" />
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores hidden text when applying the chart exemption", () => {
    const result = runRule(
      noShapeAssembledIllustration,
      `const Scene = () => <svg width="600" height="400">
        ${primitiveShapes}
        <g display="none"><text>A</text><text>B</text><text>C</text></g>
      </svg>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
