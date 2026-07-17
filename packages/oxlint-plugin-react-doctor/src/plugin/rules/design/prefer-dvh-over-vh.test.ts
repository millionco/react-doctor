import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferDvhOverVh } from "./prefer-dvh-over-vh.js";

describe("prefer-dvh-over-vh", () => {
  it("flags `min-h-screen`", () => {
    const code = `const A = () => <main className="min-h-screen" />;`;
    const result = runRule(preferDvhOverVh, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `h-screen` behind a variant", () => {
    const code = `const A = () => <div className="md:h-screen" />;`;
    const result = runRule(preferDvhOverVh, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `h-screen` behind a hyphenated variant", () => {
    const code = `const A = () => <div className="group-hover:h-screen" />;`;
    const result = runRule(preferDvhOverVh, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags arbitrary `h-[100vh]`", () => {
    const code = `const A = () => <div className="h-[100vh]" />;`;
    const result = runRule(preferDvhOverVh, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags inline `minHeight: '100vh'`", () => {
    const code = `const A = () => <div style={{ minHeight: "100vh" }} />;`;
    const result = runRule(preferDvhOverVh, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag `max-h-screen` (a valid height cap, e.g. scrollable modal)", () => {
    const code = `const A = () => <div className="max-h-screen overflow-auto" />;`;
    const result = runRule(preferDvhOverVh, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag inline `maxHeight: '100vh'`", () => {
    const code = `const A = () => <div style={{ maxHeight: "100vh" }} />;`;
    const result = runRule(preferDvhOverVh, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `min-h-dvh`", () => {
    const code = `const A = () => <main className="min-h-dvh" />;`;
    const result = runRule(preferDvhOverVh, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `w-screen` (width is a separate concern)", () => {
    const code = `const A = () => <div className="w-screen" />;`;
    const result = runRule(preferDvhOverVh, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag inline `height: '100dvh'`", () => {
    const code = `const A = () => <div style={{ height: "100dvh" }} />;`;
    const result = runRule(preferDvhOverVh, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
