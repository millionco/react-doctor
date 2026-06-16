import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTransitionAll } from "./no-transition-all.js";

describe("no-transition-all", () => {
  it('flags inline transition: "all ..."', () => {
    const code = `const A = () => <div style={{ transition: "all 200ms ease" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags inline transitionProperty: 'all'", () => {
    const code = `const A = () => <div style={{ transitionProperty: "all" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the Tailwind `transition-all` class", () => {
    const code = `const A = () => <div className="transition-all duration-200 hover:translate-y-1" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("transition-all");
  });

  it("flags `transition-all` behind a variant prefix", () => {
    const code = `const A = () => <div className="md:hover:transition-all" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag a compound token containing `transition-all` (Bugbot: substring match)", () => {
    const code = `const A = () => <div className="transition-all-custom" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag the bare `transition` class (curated property list, not `all`)", () => {
    const code = `const A = () => <div className="transition duration-200" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag specific transition utilities", () => {
    const code = `const A = () => <div className="transition-transform transition-colors" />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a specific inline transition", () => {
    const code = `const A = () => <div style={{ transition: "transform 200ms, opacity 200ms" }} />;`;
    const result = runRule(noTransitionAll, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
