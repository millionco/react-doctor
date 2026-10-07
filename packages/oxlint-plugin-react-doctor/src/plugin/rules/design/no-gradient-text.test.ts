import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noGradientText } from "./no-gradient-text.js";

describe("no-gradient-text", () => {
  it.each([
    "bg-gradient-to-r",
    "bg-gradient-to-br",
    "bg-linear-to-r",
    "bg-linear-to-br",
    "bg-linear-45",
    "bg-radial",
    "bg-conic",
  ])("flags gradient text using %s", (gradientClassName) => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <h1 className="text-transparent bg-clip-text ${gradientClassName} from-pink-500 to-violet-500">Title</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a gradient background without text clipping", () => {
    const result = runRule(
      noGradientText,
      `const Banner = () => <div className="bg-linear-to-r from-blue-500 to-cyan-500">Title</div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine utilities from different variants", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <h1 className="bg-clip-text dark:bg-linear-to-r">Title</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    "dark:text-transparent dark:bg-clip-text dark:bg-gradient-to-tr",
    "group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r",
    "motion-safe:dark:text-transparent motion-safe:dark:bg-clip-text motion-safe:dark:bg-linear-to-br",
  ])("flags gradient text within one variant scope: %s", (className) => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <h1 className="${className} from-pink-500 to-violet-500">Title</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not combine utilities from different stacked variant scopes", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <h1 className="dark:hover:bg-clip-text hover:dark:bg-gradient-to-r">Title</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("combines non-conflicting base utilities with one active variant scope", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 className="text-transparent bg-clip-text dark:bg-linear-to-r">One</h1><h1 className="bg-clip-text dark:text-transparent dark:bg-linear-(--brand-gradient)">Two</h1></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("inherits utilities from broader active variant scopes", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 className="dark:text-transparent dark:bg-clip-text dark:hover:bg-linear-to-r">One</h1><h1 className="text-transparent dark:bg-clip-text dark:hover:bg-radial-[at_50%_75%]">Two</h1></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes supported Tailwind direction and interpolation forms", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 className="text-transparent bg-clip-text bg-conic-180">One</h1><h1 className="text-transparent bg-clip-text -bg-linear-45">Two</h1><h1 className="text-transparent bg-clip-text bg-linear-to-r/srgb">Three</h1><h1 className="text-transparent bg-clip-text -bg-conic-45/[longer_hue]">Four</h1></>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it.each([
    "bg-[linear-gradient(red,blue)]",
    "bg-[radial-gradient(circle_at_center,red,blue)]",
    "bg-[conic-gradient(from_45deg,red,blue)]",
    "bg-[repeating-linear-gradient(45deg,red_0_10px,blue_10px_20px)]",
  ])("recognizes arbitrary gradient background %s", (gradientClassName) => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <h1 className="text-transparent bg-clip-text ${gradientClassName}">Title</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not recognize invalid arbitrary background image modifiers", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 className="text-transparent bg-clip-text bg-[linear-gradient(red,blue)]/50">Modifier</h1><h1 className="text-transparent bg-clip-text -bg-radial">Negative radial</h1><h1 className="text-transparent bg-clip-text bg-linear-45.5">Decimal angle</h1></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps balanced arbitrary values with spaces in one token", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <h1 className={'bg-[url("data:image/svg+xml,<svg viewBox=\\'0 0 1 1\\'></svg>")] bg-clip-text text-transparent'}>Title</h1>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("requires transparent text fill and respects definitive background resets", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 className="bg-clip-text bg-linear-to-r text-black">Title</h1><h1 className="text-transparent bg-clip-text bg-linear-to-r !bg-none">Title</h1></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("abstains when another background image has equal or higher priority", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 className="text-transparent bg-clip-text bg-linear-to-r bg-[url('/hero.png')]">URL</h1><h1 className="text-transparent bg-clip-text bg-radial bg-(image:--hero)">Variable</h1><h1 className="text-transparent bg-clip-text bg-conic !bg-[image-set(url('/hero.png')_1x)]">Important image</h1><h1 className="text-transparent bg-clip-text !bg-linear-to-r bg-[url('/hero.png')]">Important gradient</h1></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat non-color text utilities as color conflicts", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 className="text-transparent text-shadow-lg text-opacity-50 bg-clip-text bg-linear-to-r">Shadow</h1><h1 className="text-transparent text-center text-balance text-ellipsis text-sm/6 bg-clip-text bg-radial">Typography</h1><h1 className="text-transparent text-[14px] text-[length:var(--size)] bg-clip-text bg-conic">Arbitrary size</h1><h1 className="text-transparent text-box-trim-start bg-clip-text bg-linear-45">Trim</h1></>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("recognizes transparent text with an opacity modifier", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <h1 className="text-transparent/50 bg-clip-text bg-linear-to-r">Title</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("abstains when another text color has equal priority", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 className="text-transparent text-red-500 bg-clip-text bg-linear-to-r">Palette</h1><h1 className="text-transparent text-[#fff] bg-clip-text bg-radial">Arbitrary</h1><h1 className="text-transparent text-brand bg-clip-text bg-conic">Theme</h1></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("requires a transparent text fill for inline gradient clipping", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 style={{ color: "transparent", backgroundClip: "text", backgroundImage: "linear-gradient(red, blue)" }}>Gradient</h1><h1 style={{ color: "black", backgroundClip: "text", backgroundImage: "linear-gradient(red, blue)" }}>Solid</h1></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes case-insensitive gradients and modern alpha-zero colors", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 style={{ color: "rgb(20 30 40 / 0)", backgroundClip: "TEXT", backgroundImage: "LINEAR-GRADIENT(red, blue)" }}>Gradient</h1><h1 style={{ WebkitTextFillColor: "transparent", WebkitBackgroundClip: "TeXt", background: "RADIAL-GRADIENT(circle, red, blue)" }}>Radial</h1></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes percentage alpha and modern transparent color functions", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 style={{ color: "rgb(20 30 40 / 0%)", backgroundClip: "text", backgroundImage: "linear-gradient(red, blue)" }}>RGB</h1><h1 style={{ WebkitTextFillColor: "rgba(20, 30, 40, 0%)", WebkitBackgroundClip: "text", backgroundImage: "linear-gradient(red, blue)" }}>RGBA</h1><h1 style={{ color: "oklch(60% 0.2 240 / 0)", backgroundClip: "text", backgroundImage: "linear-gradient(red, blue)" }}>OKLCH</h1><h1 style={{ color: "oklab(60% 0.1 -0.1 / 0%)", backgroundClip: "text", backgroundImage: "linear-gradient(red, blue)" }}>OKLAB</h1><h1 style={{ color: "hwb(240 0% 0% / 0)", backgroundClip: "text", backgroundImage: "linear-gradient(red, blue)" }}>HWB</h1><h1 style={{ color: "color(display-p3 1 0 0 / 0%)", backgroundClip: "text", backgroundImage: "linear-gradient(red, blue)" }}>Color</h1></>;`,
    );
    expect(result.diagnostics).toHaveLength(6);
  });

  it("does not treat nonzero modern alpha values as transparent", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 style={{ color: "rgb(20 30 40 / 1%)", backgroundClip: "text", backgroundImage: "linear-gradient(red, blue)" }}>RGB</h1><h1 style={{ color: "oklch(60% 0.2 240 / 0.01)", backgroundClip: "text", backgroundImage: "linear-gradient(red, blue)" }}>OKLCH</h1><h1 style={{ color: "hwb(240 0% 0% / 50%)", backgroundClip: "text", backgroundImage: "linear-gradient(red, blue)" }}>HWB</h1></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("lets inline style override each Tailwind gradient-text property", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 className="text-transparent bg-clip-text bg-linear-to-r" style={{ color: "red" }}>Color</h1><h1 className="text-transparent bg-clip-text bg-linear-to-r" style={{ backgroundImage: "none" }}>Background</h1><h1 className="text-transparent bg-clip-text bg-linear-to-r" style={{ backgroundClip: "border-box" }}>Clip</h1></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("respects important Tailwind gradient-text declarations over inline styles", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <>
        <h1 className="!text-transparent !bg-clip-text !bg-gradient-to-r" style={{ backgroundImage: "none" }}>Gradient</h1>
        <h1 className="!text-black !bg-clip-border !bg-none" style={{ color: "transparent", backgroundClip: "text", backgroundImage: "linear-gradient(red, blue)" }}>Solid</h1>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("combines Tailwind classes with authoritative inline gradient-text properties", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 className="bg-clip-text bg-linear-to-r" style={{ color: "transparent" }}>Inline color</h1><h1 className="text-transparent bg-clip-text" style={{ backgroundImage: "linear-gradient(red, blue)" }}>Inline background</h1><h1 className="text-transparent bg-linear-to-r" style={{ backgroundClip: "text" }}>Inline clip</h1></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("stays quiet when a dynamic inline style may override Tailwind", () => {
    const result = runRule(
      noGradientText,
      `const Heading = ({ style, color }) => <><h1 className="text-transparent bg-clip-text bg-linear-to-r" style={style}>Dynamic</h1><h1 className="text-transparent bg-clip-text bg-linear-to-r" style={{ color }}>Dynamic property</h1></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("allows a static JSX spread that cannot provide style", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <h1 className="text-transparent bg-clip-text bg-linear-to-r" {...{ id: "title" }}>Title</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not confuse a gradient filename with a CSS gradient function", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <><h1 style={{ color: "transparent", backgroundClip: "text", backgroundImage: "url('/gradient.png')" }}>Name</h1><h1 style={{ color: "transparent", backgroundClip: "text", backgroundImage: "url('/linear-gradient(red).png')" }}>Function-like name</h1></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not interpret class names as Tailwind without the capability", () => {
    const result = runRule(
      noGradientText,
      `const Heading = () => <h1 className="text-transparent bg-clip-text bg-linear-to-r">Title</h1>;`,
      { settings: { "react-doctor": { capabilities: [] } } },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("only evaluates proven intrinsic elements", () => {
    const result = runRule(
      noGradientText,
      `const HeadingElement = "h1"; const Page = () => <><Heading className="text-transparent bg-clip-text bg-linear-45">Custom</Heading><HeadingElement className="text-transparent bg-clip-text bg-linear-45">Intrinsic alias</HeadingElement></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
