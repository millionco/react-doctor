import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFullViewportWidth } from "./no-full-viewport-width.js";

describe("no-full-viewport-width", () => {
  it("flags the `w-screen` class", () => {
    const code = `const A = () => <div className="w-screen bg-black" />;`;
    const result = runRule(noFullViewportWidth, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags arbitrary `w-[100vw]`", () => {
    const code = `const A = () => <div className="w-[100vw]" />;`;
    const result = runRule(noFullViewportWidth, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags inline `width: '100vw'`", () => {
    const code = `const A = () => <div style={{ width: "100vw" }} />;`;
    const result = runRule(noFullViewportWidth, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag `max-w-[100vw]` (a defensive cap, not the footgun)", () => {
    const code = `const A = () => <div className="max-w-[100vw]" />;`;
    const result = runRule(noFullViewportWidth, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag inline `maxWidth: '100vw'`", () => {
    const code = `const A = () => <div style={{ maxWidth: "100vw" }} />;`;
    const result = runRule(noFullViewportWidth, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `max-w-screen-lg` (a breakpoint max-width)", () => {
    const code = `const A = () => <div className="max-w-screen-lg" />;`;
    const result = runRule(noFullViewportWidth, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `w-full`", () => {
    const code = `const A = () => <div className="w-full" />;`;
    const result = runRule(noFullViewportWidth, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag `h-screen` (height, different concern)", () => {
    const code = `const A = () => <div className="h-screen" />;`;
    const result = runRule(noFullViewportWidth, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag inline `width: '100%'`", () => {
    const code = `const A = () => <div style={{ width: "100%" }} />;`;
    const result = runRule(noFullViewportWidth, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
