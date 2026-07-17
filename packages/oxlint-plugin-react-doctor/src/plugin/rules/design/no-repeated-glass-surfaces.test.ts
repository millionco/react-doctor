import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRepeatedGlassSurfaces } from "./no-repeated-glass-surfaces.js";

describe("no-repeated-glass-surfaces", () => {
  it("flags a page built from repeated glass panels", () => {
    const result = runRule(
      noRepeatedGlassSurfaces,
      `const Page = () => <main><section className="rounded-xl border bg-white/10 backdrop-blur-xl">A</section><section className="rounded-xl border bg-white/10 backdrop-blur-xl">B</section><section className="rounded-xl border bg-white/10 backdrop-blur-xl">C</section></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts one glass overlay and opaque cards", () => {
    const result = runRule(
      noRepeatedGlassSurfaces,
      `const Page = () => <main><aside className="rounded-xl border bg-white/20 backdrop-blur-md">Menu</aside><section className="rounded-xl border bg-white">A</section><section className="rounded-xl border bg-white">B</section></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not aggregate separate component trees", () => {
    const result = runRule(
      noRepeatedGlassSurfaces,
      `const A = () => <main><div className="rounded-xl border bg-white/10 backdrop-blur-xl" /></main>; const B = () => <main><div className="rounded-xl border bg-white/10 backdrop-blur-xl" /><div className="rounded-xl border bg-white/10 backdrop-blur-xl" /></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
