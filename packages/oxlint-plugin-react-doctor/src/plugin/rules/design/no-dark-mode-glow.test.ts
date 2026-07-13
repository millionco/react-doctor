import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDarkModeGlow } from "./no-dark-mode-glow.js";

const run = (boxShadow: string) =>
  runRule(
    noDarkModeGlow,
    `const Card = () => <div style={{ backgroundColor: "#000", boxShadow: "${boxShadow}" }} />;`,
  );

describe("no-dark-mode-glow", () => {
  it.each([
    "0 0 60px rgba(255, 0, 0, 0)",
    "0 0 60px rgba(255, 0, 0, 0.0)",
    "0 0 60px rgba(255, 0, 0, 0%)",
    "0 0 60px rgb(255, 0, 0, 0)",
    "0 0 60px rgb(255 0 0 / 0)",
    "0 0 60px rgb(255 0 0 / 0%)",
    "0 0 60px rgba(255 0 0 / .0)",
    "0 0 60px #f000",
    "0 0 60px #ff000000",
  ])("does not flag a statically transparent shadow: %s", (boxShadow) => {
    expect(run(boxShadow).diagnostics).toEqual([]);
  });

  it.each([
    "0 0 60px rgba(255, 0, 0, 0.0001)",
    "0 0 60px rgba(255, 0, 0, 0.1%)",
    "0 0 60px rgb(255, 0, 0, 0.0001)",
    "0 0 60px rgb(255 0 0 / 0.0001)",
    "0 0 60px rgb(255 0 0 / 0.1%)",
    "0 0 60px #f001",
    "0 0 60px #ff000001",
    "0 0 60px #ff000010",
  ])("still flags a visible colored shadow: %s", (boxShadow) => {
    expect(run(boxShadow).diagnostics).toHaveLength(1);
  });

  it.each([
    "0 0 60px rgba(255, 0, 0, var(--alpha))",
    "0 0 60px rgb(255 0 0 / var(--alpha))",
    "0 0 60px rgb(255 0 0 / calc(0 * 1%))",
    "0 0 60px var(--shadow-color, #f000)",
    "0 0 60px var(--shadow-color, rgb(255 0 0 / 0%))",
  ])("keeps unresolved alpha conservative: %s", (boxShadow) => {
    expect(run(boxShadow).diagnostics).toHaveLength(1);
  });

  it("still flags a visible qualifying layer after a transparent layer", () => {
    expect(
      run("0 0 60px rgba(255, 0, 0, 0), 0 0 60px rgba(0, 128, 255, 0.8)").diagnostics,
    ).toHaveLength(1);
  });

  it("does not flag several fully transparent colored layers", () => {
    expect(run("0 0 60px rgb(255 0 0 / 0%), 0 0 80px #0088ff00").diagnostics).toEqual([]);
  });

  it("does not split a nested fallback comma into another shadow layer", () => {
    expect(run("0 0 60px rgba(255, 0, 0, var(--alpha, 0))").diagnostics).toHaveLength(1);
  });
});
