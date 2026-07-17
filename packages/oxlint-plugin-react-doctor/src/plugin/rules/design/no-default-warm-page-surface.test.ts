import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDefaultWarmPageSurface } from "./no-default-warm-page-surface.js";

describe("no-default-warm-page-surface", () => {
  it("flags a warm neutral main surface", () => {
    const result = runRule(
      noDefaultWarmPageSurface,
      `const Page = () => <main className="min-h-screen bg-stone-50">Content</main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a full-page wrapper", () => {
    const result = runRule(
      noDefaultWarmPageSurface,
      `const Page = () => <div className="min-h-dvh bg-amber-50">Content</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a local warm component", () => {
    const result = runRule(
      noDefaultWarmPageSurface,
      `const Note = () => <aside className="bg-amber-50">Note</aside>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a neutral page surface", () => {
    const result = runRule(
      noDefaultWarmPageSurface,
      `const Page = () => <main className="min-h-screen bg-white">Content</main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a dark-mode surface as the page default", () => {
    const result = runRule(
      noDefaultWarmPageSurface,
      `const Page = () => <main className="bg-white dark:bg-stone-50">Content</main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
