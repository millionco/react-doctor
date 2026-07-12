import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDarkModeGlow } from "./no-dark-mode-glow.js";

const run = (boxShadow: string) =>
  runRule(
    noDarkModeGlow,
    `const Card = () => <div style={{ backgroundColor: "#000", boxShadow: "${boxShadow}" }} />;`,
  );

describe("no-dark-mode-glow", () => {
  it("does not flag a fully transparent legacy rgba shadow", () => {
    expect(run("0 0 60px rgba(255, 0, 0, 0)").diagnostics).toEqual([]);
  });

  it("still flags a visible colored legacy rgba shadow", () => {
    expect(run("0 0 60px rgba(255, 0, 0, 0.01)").diagnostics).toHaveLength(1);
  });

  it("still flags a visible qualifying layer after a transparent layer", () => {
    expect(
      run("0 0 60px rgba(255, 0, 0, 0), 0 0 60px rgba(0, 128, 255, 0.8)").diagnostics,
    ).toHaveLength(1);
  });
});
