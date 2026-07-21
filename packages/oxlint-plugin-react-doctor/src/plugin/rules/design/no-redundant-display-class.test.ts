import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRedundantDisplayClass } from "./no-redundant-display-class.js";

describe("no-redundant-display-class", () => {
  it("flags `block` on a `<div>`", () => {
    const code = `const A = () => <div className="block rounded-lg p-4" />;`;
    const result = runRule(noRedundantDisplayClass, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `inline` on a `<span>`", () => {
    const code = `const A = () => <span className="inline text-sm" />;`;
    const result = runRule(noRedundantDisplayClass, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag important display utilities that can override authored CSS", () => {
    const code = `const A = () => <><div className="!block" /><span className="inline!" /></>;`;
    const result = runRule(noRedundantDisplayClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("declares its Tailwind and React JSX capability gates", () => {
    expect(noRedundantDisplayClass.requires).toContain("tailwind");
    expect(noRedundantDisplayClass.tags).toContain("react-jsx-only");
  });

  it("does NOT flag `inline-block` on a span (different display)", () => {
    const code = `const A = () => <span className="inline-block" />;`;
    const result = runRule(noRedundantDisplayClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `block` on an `<a>` (a is inline by default)", () => {
    const code = `const A = () => <a className="block" href="/x">x</a>;`;
    const result = runRule(noRedundantDisplayClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a breakpoint-prefixed `md:block`", () => {
    const code = `const A = () => <div className="hidden md:block" />;`;
    const result = runRule(noRedundantDisplayClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `flex`/`grid`/`hidden` (meaningful displays)", () => {
    const code = `const A = () => <div className="flex items-center" />;`;
    const result = runRule(noRedundantDisplayClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a default display utility that competes with another display utility", () => {
    const code = `const A = () => (
      <>
        <div className="flex block" />
        <div className="grid block" />
        <div className="hidden block" />
        <span className="inline-flex inline" />
      </>
    );`;
    const result = runRule(noRedundantDisplayClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT treat arbitrary-value fragments as display utilities", () => {
    const code = `const A = () => <div className="[--display:x block y]" />;`;
    const result = runRule(noRedundantDisplayClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `block` on an `<li>` (li defaults to list-item, so block is meaningful)", () => {
    const code = `const A = () => <li className="block">x</li>;`;
    const result = runRule(noRedundantDisplayClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
