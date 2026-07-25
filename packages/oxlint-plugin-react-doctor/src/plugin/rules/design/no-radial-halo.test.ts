import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRadialHalo } from "./no-radial-halo.js";

describe("no-radial-halo", () => {
  it("flags saturated inline halos on their own dark surfaces", () => {
    const result = runRule(
      noRadialHalo,
      `const Hero = () => (
        <>
          <div style={{ backgroundColor: "#050816", backgroundImage: "radial-gradient(circle at center, rgb(56 189 248 / 80%) 0%, transparent 70%)" }} />
          <section style={{ backgroundColor: "rgb(3 7 18)", backgroundImage: "radial-gradient(ellipse, #8b5cf6cc 0%, #8b5cf600 75%)" }} />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a halo whose static JSX root proves the dark page surface", () => {
    const result = runRule(
      noRadialHalo,
      `const Hero = () => (
        <main style={{ background: "#020617" }}>
          <section>
            <div style={{ background: "radial-gradient(circle, rgba(14,165,233,0.75), transparent 65%)" }} />
          </section>
        </main>
      );`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("includes the visible and transparent alpha boundaries", () => {
    const result = runRule(
      noRadialHalo,
      `const Hero = () => <div style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(rgb(37 99 235 / 70%), rgb(0 0 0 / 5%))" }} />;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags conservative Tailwind arbitrary halo and dark-surface forms", () => {
    const result = runRule(
      noRadialHalo,
      `const Hero = () => (
        <main className="[background-color:#020617]">
          <div className="bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.8)_0%,transparent_70%)]" />
          <aside className="[background-image:radial-gradient(ellipse,#db2777cc_0%,#db277700_72%)]" />
        </main>
      );`,
    );

    expect(result.diagnostics).toHaveLength(2);
  });

  it("ignores low-alpha spotlights and neutral vignettes", () => {
    const result = runRule(
      noRadialHalo,
      `const Surfaces = () => (
        <>
          <div style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 40%), transparent)" }} />
          <div style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 69%), transparent)" }} />
          <div style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(circle, rgb(100 100 100 / 80%), transparent)" }} />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores light, translucent, unknown, and absent root backgrounds", () => {
    const gradient = "radial-gradient(circle, rgb(37 99 235 / 80%), transparent)";
    const result = runRule(
      noRadialHalo,
      `const Surfaces = ({ surface }) => (
        <>
          <div style={{ backgroundColor: "#ffffff", backgroundImage: "${gradient}" }} />
          <div style={{ backgroundColor: "rgb(0 0 0 / 50%)", backgroundImage: "${gradient}" }} />
          <div style={{ backgroundColor: surface, backgroundImage: "${gradient}" }} />
          <div style={{ backgroundImage: "${gradient}" }} />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores a dark intermediate ancestor that is neither the surface nor root", () => {
    const result = runRule(
      noRadialHalo,
      `const Hero = () => (
        <main>
          <section style={{ backgroundColor: "#020617" }}>
            <div style={{ backgroundImage: "radial-gradient(circle, rgb(37 99 235 / 80%), transparent)" }} />
          </section>
        </main>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores repeating, layered, nonradial, URL, and unresolved images", () => {
    const result = runRule(
      noRadialHalo,
      `const Surfaces = ({ image }) => (
        <>
          <div style={{ backgroundColor: "#020617", backgroundImage: "repeating-radial-gradient(#2563ebcc 0 10px, transparent 10px 30px)" }} />
          <div style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(#2563ebcc, transparent), url('/noise.png')" }} />
          <div style={{ backgroundColor: "#020617", backgroundImage: "linear-gradient(#2563ebcc, transparent)" }} />
          <div style={{ backgroundColor: "#020617", backgroundImage: "url('/halo.png')" }} />
          <div style={{ backgroundColor: "#020617", backgroundImage: image }} />
          <div style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(var(--halo), transparent)" }} />
          <div style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(rgb(37 99 235 / 0.8junk), transparent)" }} />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores nontransparent endings and a weak first visible stop", () => {
    const result = runRule(
      noRadialHalo,
      `const Surfaces = () => (
        <>
          <div style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(rgb(37 99 235 / 80%), rgb(37 99 235 / 20%))" }} />
          <div style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(rgb(37 99 235 / 20%), rgb(37 99 235 / 80%), transparent)" }} />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores pixel halos at or below 24px but reports a larger one", () => {
    const result = runRule(
      noRadialHalo,
      `const Surfaces = () => (
        <>
          <div style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(circle, #2563ebcc 0, transparent 24px)" }} />
          <div style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(circle, #2563ebcc 0, transparent 25px)" }} />
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps dynamic and important overrides conservative", () => {
    const result = runRule(
      noRadialHalo,
      `const Surfaces = ({ className, style }) => (
        <>
          <div className={className} style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(#2563ebcc, transparent)" }} />
          <div className="bg-[radial-gradient(#2563ebcc,transparent)] [background-image:var(--surface)]" style={{ backgroundColor: "#020617" }} />
          <div className="bg-[radial-gradient(#2563ebcc,transparent)] !bg-none" style={{ backgroundColor: "#020617" }} />
          <div className="!bg-white" style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(#2563ebcc, transparent)" }} />
          <main className="[background-color:#020617] bg-white"><div className="bg-[radial-gradient(#2563ebcc,transparent)]" /></main>
          <main style={style}><div className="bg-[radial-gradient(#2563ebcc,transparent)]" /></main>
        </>
      );`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores standard Tailwind dark colors as positive evidence", () => {
    const result = runRule(
      noRadialHalo,
      `const Hero = () => <main className="bg-black"><div className="bg-[radial-gradient(#2563ebcc,transparent)]" /></main>;`,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores halos in data visualizations", () => {
    const result = runRule(
      noRadialHalo,
      `const Chart = () => <Chart><div style={{ backgroundColor: "#020617", backgroundImage: "radial-gradient(#2563ebcc, transparent)" }} /></Chart>;`,
      { filename: "/src/Chart.tsx" },
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
