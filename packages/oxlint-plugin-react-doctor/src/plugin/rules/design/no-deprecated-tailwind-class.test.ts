import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDeprecatedTailwindClass } from "./no-deprecated-tailwind-class.js";

describe("no-deprecated-tailwind-class", () => {
  it("flags `bg-gradient-to-r` (renamed to bg-linear-to-r)", () => {
    const code = `const A = () => <div className="bg-gradient-to-r from-black to-white" />;`;
    const result = runRule(noDeprecatedTailwindClass, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("bg-linear-to-r");
  });

  it("flags `flex-shrink-0` (renamed to shrink-0)", () => {
    const code = `const A = () => <div className="flex-shrink-0" />;`;
    const result = runRule(noDeprecatedTailwindClass, code);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("shrink-0");
  });

  it("flags `flex-grow` and `overflow-ellipsis`", () => {
    const code = `const A = () => <div className="flex-grow overflow-ellipsis" />;`;
    const result = runRule(noDeprecatedTailwindClass, code);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags a deprecated class behind a variant prefix", () => {
    const code = `const A = () => <div className="md:flex-shrink-0" />;`;
    const result = runRule(noDeprecatedTailwindClass, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an important deprecated class behind a hyphenated variant", () => {
    const code = `const A = () => <div className="group-hover:!flex-shrink-0" />;`;
    const result = runRule(noDeprecatedTailwindClass, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag the canonical replacements", () => {
    const code = `const A = () => <div className="bg-linear-to-r shrink-0 grow text-ellipsis" />;`;
    const result = runRule(noDeprecatedTailwindClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `overflow-clip` (a current `overflow: clip` utility, not `text-clip`)", () => {
    const code = `const A = () => <div className="overflow-clip" />;`;
    const result = runRule(noDeprecatedTailwindClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT mis-suggest for `bg-gradient-radial` (v4 is `bg-radial`, not `bg-linear-radial`)", () => {
    const code = `const A = () => <div className="bg-gradient-radial" />;`;
    const result = runRule(noDeprecatedTailwindClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `flex`, `flex-1`, or `flex-col` (not the deprecated names)", () => {
    const code = `const A = () => <div className="flex flex-1 flex-col" />;`;
    const result = runRule(noDeprecatedTailwindClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag utility names that only share deprecated prefixes", () => {
    const code = `const A = () => <div className="flex-shrinkable flex-grower bg-gradient-to-random" />;`;
    const result = runRule(noDeprecatedTailwindClass, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
