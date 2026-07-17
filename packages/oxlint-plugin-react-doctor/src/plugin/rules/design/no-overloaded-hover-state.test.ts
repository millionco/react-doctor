import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noOverloadedHoverState } from "./no-overloaded-hover-state.js";

describe("no-overloaded-hover-state", () => {
  it("flags three distinct hover effects on one element", () => {
    const result = runRule(
      noOverloadedHoverState,
      `const Card = () => <article className="hover:-translate-y-1 hover:scale-105 hover:shadow-xl hover:bg-white" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows restrained hover feedback", () => {
    const result = runRule(
      noOverloadedHoverState,
      `const Card = () => <article className="hover:bg-white hover:text-black hover:shadow-sm" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine responsive or group-hover utilities", () => {
    const result = runRule(
      noOverloadedHoverState,
      `const Card = () => <article className="md:scale-105 group-hover:rotate-2 hover:shadow-lg" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
