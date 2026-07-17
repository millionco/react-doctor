import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noHeroEyebrowChip } from "./no-hero-eyebrow-chip.js";

describe("no-hero-eyebrow-chip", () => {
  it("flags a tracked eyebrow above a display h1", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header><p className="uppercase tracking-widest">Built for teams</p><h1 className="text-7xl">Work together</h1></header>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a pill chip above a display h1", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header><span className="rounded-full bg-blue-100 px-3 py-1">New release</span><h1 className="text-6xl">Work together</h1></header>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts breadcrumbs and ordinary section labels", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header><nav>Home / Product</nav><h1 className="text-7xl">Work together</h1></header>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts rounded labels without a visible chip surface", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header><span className="rounded-full px-3 py-1">Release notes</span><h1 className="text-6xl">Work together</h1></header>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts labels before restrained headings", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Section = () => <section><p className="uppercase tracking-wide">Details</p><h1 className="text-3xl">Configuration</h1></section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not assemble an eyebrow treatment across variants", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header><p className="uppercase dark:tracking-widest">Built for teams</p><h1 className="text-7xl">Work together</h1></header>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
