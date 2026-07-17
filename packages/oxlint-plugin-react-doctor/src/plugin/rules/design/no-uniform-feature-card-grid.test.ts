import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUniformFeatureCardGrid } from "./no-uniform-feature-card-grid.js";

describe("no-uniform-feature-card-grid", () => {
  it("flags a generic grid made entirely from matching feature cards", () => {
    const result = runRule(
      noUniformFeatureCardGrid,
      `const Features = () => <section className="grid grid-cols-3 gap-6"><article className="rounded-xl border p-6"><h3>Fast</h3><p>Finish work sooner.</p></article><article className="rounded-xl border p-6"><h3>Safe</h3><p>Protect every change.</p></article><article className="rounded-xl border p-6"><h3>Simple</h3><p>Keep the flow clear.</p></article></section>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a grid with varied composition", () => {
    const result = runRule(
      noUniformFeatureCardGrid,
      `const Features = () => <section className="grid grid-cols-3 gap-6"><article className="rounded-xl border p-6"><h3>Fast</h3></article><blockquote>Customer story</blockquote><figure>Diagram</figure></section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts semantic product lists", () => {
    const result = runRule(
      noUniformFeatureCardGrid,
      `const Products = () => <ul className="grid grid-cols-3"><li className="rounded-xl border p-6"><h3>A</h3></li><li className="rounded-xl border p-6"><h3>B</h3></li><li className="rounded-xl border p-6"><h3>C</h3></li></ul>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts compact metric cards without feature copy", () => {
    const result = runRule(
      noUniformFeatureCardGrid,
      `const Stats = () => <div className="grid grid-cols-3"><div className="rounded-xl border p-6"><h3>Users</h3><strong>42</strong></div><div className="rounded-xl border p-6"><h3>Revenue</h3><strong>$9k</strong></div><div className="rounded-xl border p-6"><h3>Latency</h3><strong>80ms</strong></div></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
