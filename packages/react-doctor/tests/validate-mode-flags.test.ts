import { describe, expect, it } from "vite-plus/test";
import { validateModeFlags } from "../src/cli/utils/validate-mode-flags.js";

describe("validateModeFlags", () => {
  it("allows JSON mode with --blocking", () => {
    expect(() => validateModeFlags({ json: true, blocking: "none" })).not.toThrow();
  });

  it("rejects --score combined with --no-telemetry (contradictory intent)", () => {
    expect(() => validateModeFlags({ score: true, telemetry: false })).toThrow(
      "Cannot combine --score with --no-telemetry",
    );
  });

  it("allows --no-telemetry without --score", () => {
    expect(() => validateModeFlags({ telemetry: false })).not.toThrow();
  });

  it("allows --yes and --full together (skip prompts + force a full scan are orthogonal)", () => {
    expect(() => validateModeFlags({ yes: true, full: true })).not.toThrow();
  });

  it("rejects --sfw combined with --json / --score / --staged / --diff", () => {
    expect(() => validateModeFlags({ sfw: true, json: true })).toThrow("Cannot combine --sfw");
    expect(() => validateModeFlags({ sfw: true, score: true })).toThrow("Cannot combine --sfw");
    expect(() => validateModeFlags({ sfw: true, staged: true })).toThrow("Cannot combine --sfw");
    expect(() => validateModeFlags({ sfw: true, diff: "main" })).toThrow("Cannot combine --sfw");
  });

  it("allows --sfw on its own", () => {
    expect(() => validateModeFlags({ sfw: true })).not.toThrow();
  });
});
