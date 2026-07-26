import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDecorativeRadialSpotlight } from "./no-decorative-radial-spotlight.js";

describe("no-decorative-radial-spotlight", () => {
  it("flags large inline radial spotlights", () => {
    const result = runRule(
      noDecorativeRadialSpotlight,
      `const Hero = () => (
        <>
          <div style={{ width: 320, height: 180, backgroundImage: "radial-gradient(circle at center, rgb(37 99 235 / 25%) 0%, transparent 70%)" }} />
          <section style={{ width: "20rem", height: "10rem", background: "radial-gradient(ellipse, #7c3aed38 0%, #7c3aed1f 35%, #0000 75%)" }} />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags supported Tailwind arbitrary radial spotlights", () => {
    const result = runRule(
      noDecorativeRadialSpotlight,
      `const Hero = () => (
        <>
          <div className="h-48 w-80 bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.25)_0%,transparent_70%)]" />
          <aside className="h-[180px] w-[300px] [background-image:radial-gradient(ellipse,#db277733_0%,#db277700_72%)]" />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags an exact fixed viewport spotlight without explicit dimensions", () => {
    const result = runRule(
      noDecorativeRadialSpotlight,
      `const Backdrop = () => (
        <>
          <div className="fixed inset-0 bg-[radial-gradient(circle,rgba(14,165,233,0.2),transparent_65%)]" />
          <div style={{ position: "fixed", inset: 0, backgroundImage: "radial-gradient(circle, hsl(262 83% 58% / 20%), transparent 70%)" }} />
          <div style={{ position: "fixed", inset: "0px", backgroundImage: "radial-gradient(circle, hsl(262 83% 58% / 20%), transparent 70%)" }} />
          <div style={{ position: "fixed", top: 0, right: "0px", bottom: 0, left: "0rem", backgroundImage: "radial-gradient(circle, hsl(262 83% 58% / 20%), transparent 70%)" }} />
          <div className="fixed inset-x-0 inset-y-0 bg-[radial-gradient(circle,rgba(14,165,233,0.2),transparent_65%)]" />
          <div className="fixed top-0 right-0 bottom-0 left-0 bg-[radial-gradient(circle,rgba(14,165,233,0.2),transparent_65%)]" />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(6);
  });

  it("ignores neutral vignettes and gradients with multiple colors", () => {
    const result = runRule(
      noDecorativeRadialSpotlight,
      `const Surfaces = () => (
        <>
          <div className="h-48 w-80 bg-[radial-gradient(circle,rgba(100,100,100,0.2),transparent_70%)]" />
          <div className="h-48 w-80 bg-[radial-gradient(circle,rgba(37,99,235,0.2),rgba(168,85,247,0.15),transparent_70%)]" />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores opaque, nearly invisible, and nontransparent endings", () => {
    const result = runRule(
      noDecorativeRadialSpotlight,
      `const Surfaces = () => (
        <>
          <div style={{ width: 320, height: 180, backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 45%), transparent)" }} />
          <div style={{ width: 320, height: 180, backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 5%), transparent)" }} />
          <div style={{ width: 320, height: 180, backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 20%), rgb(37 99 235 / 10%))" }} />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores repeating, nonradial, layered, and unparseable gradients", () => {
    const result = runRule(
      noDecorativeRadialSpotlight,
      `const Surfaces = () => (
        <>
          <div className="h-48 w-80 bg-[repeating-radial-gradient(circle,rgba(37,99,235,0.2)_0_10px,transparent_10px_20px)]" />
          <div className="h-48 w-80 bg-[linear-gradient(rgba(37,99,235,0.2),transparent)]" />
          <div style={{ width: 320, height: 180, backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 20%), transparent), linear-gradient(white, black)" }} />
          <div style={{ width: 320, height: 180, backgroundImage: "radial-gradient(circle, color(display-p3 0.1 0.4 1 / 20%), transparent)" }} />
          <div style={{ width: 320, height: 180, backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 0.2junk), transparent)" }} />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores small and unresolved surfaces", () => {
    const result = runRule(
      noDecorativeRadialSpotlight,
      `const Surfaces = ({ size }) => (
        <>
          <span className="size-12 rounded-full bg-[radial-gradient(circle,rgba(37,99,235,0.2),transparent)]" />
          <div className="h-full w-full bg-[radial-gradient(circle,rgba(37,99,235,0.2),transparent)]" />
          <div style={{ width: size, height: 180, backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 20%), transparent)" }} />
          <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(37,99,235,0.2),transparent)]" />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores dynamic and overriding style or class values", () => {
    const result = runRule(
      noDecorativeRadialSpotlight,
      `const Surfaces = ({ backgroundImage, className, style }) => (
        <>
          <div className={className} style={{ width: 320, height: 180, backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 20%), transparent)" }} />
          <div className="h-48 w-80 bg-[radial-gradient(circle,rgba(37,99,235,0.2),transparent)]" style={style} />
          <div className="h-48 w-80 bg-[radial-gradient(circle,rgba(37,99,235,0.2),transparent)] !bg-none" />
          <div className="h-48 w-80 bg-[radial-gradient(circle,rgba(37,99,235,0.2),transparent)] bg-[image:var(--surface)]" />
          <div className="h-48 w-80 bg-[radial-gradient(circle,rgba(37,99,235,0.2),transparent)] [background-image:var(--surface)]" />
          <div className="!h-12 !w-12" style={{ width: 320, height: 180, backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 20%), transparent)" }} />
          <div className="!relative inset-0 bg-[radial-gradient(circle,rgba(37,99,235,0.2),transparent)]" style={{ position: "fixed" }} />
          <div className="fixed inset-x-0 inset-y-0 top-1 bg-[radial-gradient(circle,rgba(14,165,233,0.2),transparent)]" />
          <div className="fixed inset-x-0 inset-y-0 !top-1 bg-[radial-gradient(circle,rgba(14,165,233,0.2),transparent)]" />
          <div className="fixed inset-0 -top-1 bg-[radial-gradient(circle,rgba(14,165,233,0.2),transparent)]" />
          <div className="absolute top-[-10%] h-[40vw] w-[40vw] bg-[radial-gradient(circle,rgba(14,165,233,0.2),transparent)]" />
          <div className="fixed inset-x-0 inset-y-0 bg-[radial-gradient(circle,rgba(14,165,233,0.2),transparent)]" style={{ top: 1 }} />
          <div className="fixed inset-x-0 bg-[radial-gradient(circle,rgba(14,165,233,0.2),transparent)]" />
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 1, backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 20%), transparent)" }} />
          <div style={{ width: 320, height: 180, backgroundImage }} />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores more than two visible stops and data visualizations", () => {
    const gradient =
      "radial-gradient(circle, rgba(37,99,235,0.3), rgba(37,99,235,0.2), rgba(37,99,235,0.1), transparent)";
    const result = runRule(
      noDecorativeRadialSpotlight,
      `const Chart = () => (
        <>
          <div style={{ width: 320, height: 180, backgroundImage: "${gradient}" }} />
          <Chart><div style={{ width: 320, height: 180, backgroundImage: "radial-gradient(circle, rgba(37,99,235,0.2), transparent)" }} /></Chart>
        </>
      );`,
      { filename: "/src/Hero.tsx" },
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
