import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDefaultPurplePageGradient } from "./no-default-purple-page-gradient.js";

describe("no-default-purple-page-gradient", () => {
  it("flags a page-wide violet to cyan gradient", () => {
    const result = runRule(
      noDefaultPurplePageGradient,
      `const Page = () => <main className="min-h-screen bg-gradient-to-br from-violet-600 to-cyan-400">Content</main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the Tailwind v4 linear utility", () => {
    const result = runRule(
      noDefaultPurplePageGradient,
      `const Page = () => <div className="min-h-dvh bg-linear-to-r from-indigo-500 to-pink-500">Content</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a local gradient component", () => {
    const result = runRule(
      noDefaultPurplePageGradient,
      `const Badge = () => <span className="bg-gradient-to-r from-violet-500 to-pink-500">New</span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a restrained same-family page gradient", () => {
    const result = runRule(
      noDefaultPurplePageGradient,
      `const Page = () => <main className="min-h-screen bg-gradient-to-b from-slate-950 to-slate-900">Content</main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine gradient stops across variants", () => {
    const result = runRule(
      noDefaultPurplePageGradient,
      `const Page = () => <main className="bg-gradient-to-r from-violet-500 dark:to-cyan-400">Content</main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
