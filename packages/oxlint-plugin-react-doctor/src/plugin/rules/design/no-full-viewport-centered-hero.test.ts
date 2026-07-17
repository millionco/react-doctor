import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFullViewportCenteredHero } from "./no-full-viewport-centered-hero.js";

describe("no-full-viewport-centered-hero", () => {
  it("flags a full-screen centered hero template", () => {
    const result = runRule(
      noFullViewportCenteredHero,
      `const Hero = () => <section className="flex min-h-dvh items-center justify-center"><div><h1>Build faster</h1><p>Everything you need.</p></div></section>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the grid centering shorthand", () => {
    const result = runRule(
      noFullViewportCenteredHero,
      `const Hero = () => <header className="grid h-screen place-items-center"><h1>Welcome</h1></header>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a bounded or asymmetrical hero", () => {
    const result = runRule(
      noFullViewportCenteredHero,
      `const Hero = () => <section className="grid min-h-[60vh] items-center"><h1>Build faster</h1></section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts not-found pages and composition-rich full-height sections", () => {
    const notFoundResult = runRule(
      noFullViewportCenteredHero,
      `const NotFound = () => <section className="flex min-h-screen items-center justify-center"><h1>Not found</h1></section>;`,
      { filename: "/app/not-found.tsx" },
    );
    const richResult = runRule(
      noFullViewportCenteredHero,
      `const Hero = () => <section className="flex min-h-screen items-center justify-center"><h1>Explore</h1><nav /><figure /><aside /><div /><div /><div /><div /><div /><div /><div /><div /><div /></section>;`,
    );
    expect(notFoundResult.diagnostics).toHaveLength(0);
    expect(richResult.diagnostics).toHaveLength(0);
  });
});
