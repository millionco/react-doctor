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

  it("flags a sentence-case label with a chromatic dash pseudo-element", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header><p className="text-sm before:content-[''] before:inline-block before:w-7 before:h-[3px] before:bg-orange-500">Distributed tracing</p><h1 className="text-7xl">Find the service that started it</h1></header>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports static after pseudo-elements and arbitrary chromatic colors", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header><p className="text-[0.8125rem] after:[content:''] after:block after:w-[2rem] after:h-px after:bg-[#e84a1c]">Distributed tracing</p><h1 className="text-6xl">Find the service that started it</h1></header>;`,
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

  it("honors effective transforms, tracking, rounding, padding, and heading size", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header>
        <p className="uppercase tracking-normal">Normal tracking</p><h1 className="text-7xl">One</h1>
        <p className="uppercase !normal-case tracking-widest">Normal case wins</p><h1 className="text-7xl">Two</h1>
        <p className="rounded-full !rounded-none bg-blue-100 px-3">No pill radius</p><h1 className="text-7xl">Three</h1>
        <p className="rounded-full bg-blue-100 px-3 !px-0">No pill padding</p><h1 className="text-7xl">Four</h1>
        <p className="uppercase tracking-widest">Small heading wins</p><h1 className="text-7xl !text-sm">Five</h1>
      </header>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when treatment utilities are ambiguous", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header>
        <p className="uppercase normal-case tracking-widest">Ambiguous case</p><h1 className="text-7xl">One</h1>
        <p className="uppercase tracking-wide tracking-widest">Ambiguous tracking</p><h1 className="text-7xl">Two</h1>
        <p className="rounded-full rounded-lg bg-blue-100 px-3">Ambiguous radius</p><h1 className="text-7xl">Three</h1>
        <p className="rounded-full bg-blue-100 px-2 px-3">Ambiguous padding</p><h1 className="text-7xl">Four</h1>
        <p className="uppercase tracking-widest">Ambiguous heading</p><h1 className="text-5xl text-7xl">Five</h1>
      </header>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports unambiguous important tracked and pill treatments", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header>
        <p className="normal-case !uppercase tracking-normal !tracking-widest">Tracked label</p><h1 className="text-sm !text-7xl">One</h1>
        <p className="rounded-none !rounded-full bg-blue-100 px-0 !px-3">Pill label</p><h1 className="text-sm !text-6xl">Two</h1>
      </header>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("requires one static pseudo-element to own the full dash treatment", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header>
        <p className="text-sm before:content-[''] before:inline-block before:w-7 before:h-[3px] after:bg-orange-500">Mixed pseudo-elements</p><h1 className="text-7xl">One</h1>
        <p className="text-sm md:before:content-[''] md:before:inline-block md:before:w-7 md:before:h-[3px] md:before:bg-orange-500">Responsive only</p><h1 className="text-7xl">Two</h1>
        <p className="text-sm before:content-[''] before:inline-block before:w-7 before:h-[3px] before:bg-orange-500 before:bg-transparent">Conflicting background</p><h1 className="text-7xl">Three</h1>
      </header>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts neutral, invisible, and out-of-range pseudo-element lines", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header>
        <p className="text-sm before:content-[''] before:inline-block before:w-7 before:h-[3px] before:bg-gray-500">Neutral line</p><h1 className="text-7xl">One</h1>
        <p className="text-sm before:content-[''] before:inline-block before:w-7 before:h-[3px] before:bg-[#777777]">Achromatic line</p><h1 className="text-7xl">Two</h1>
        <p className="text-sm before:content-[''] before:inline-block before:w-7 before:h-[3px] before:bg-blue-500 before:bg-opacity-0">Invisible line</p><h1 className="text-7xl">Three</h1>
        <p className="text-sm before:content-[''] before:inline-block before:w-1 before:h-px before:bg-blue-500">Too narrow</p><h1 className="text-7xl">Four</h1>
        <p className="text-sm before:content-[''] before:inline-block before:w-24 before:h-px before:bg-blue-500">Too wide</p><h1 className="text-7xl">Five</h1>
        <p className="text-sm before:content-[''] before:inline-block before:w-7 before:h-2 before:bg-blue-500">Too tall</p><h1 className="text-7xl">Six</h1>
      </header>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires empty content, visible box layout, adjacency, and a display h1", () => {
    const result = runRule(
      noHeroEyebrowChip,
      `const Hero = () => <header>
        <p className="text-sm before:content-['—'] before:inline-block before:w-7 before:h-[3px] before:bg-blue-500">Text content</p><h1 className="text-7xl">One</h1>
        <p className="text-sm before:content-[''] before:w-7 before:h-[3px] before:bg-blue-500">No display</p><h1 className="text-7xl">Two</h1>
        <p className="text-sm before:inline-block before:w-7 before:h-[3px] before:bg-blue-500">No content utility</p><h1 className="text-7xl">Three</h1>
        <p className="text-sm before:content-[''] before:inline-block before:w-7 before:h-[3px] before:bg-blue-500">Not adjacent</p><span>Context</span><h1 className="text-7xl">Four</h1>
        <p className="text-sm before:content-[''] before:inline-block before:w-7 before:h-[3px] before:bg-blue-500">Restrained heading</p><h1 className="text-3xl">Five</h1>
        <p>— Ordinary prose label</p><h1 className="text-7xl">Six</h1>
        <p className="text-base before:content-[''] before:inline-block before:w-7 before:h-[3px] before:bg-blue-500">Regular text</p><h1 className="text-7xl">Seven</h1>
      </header>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
