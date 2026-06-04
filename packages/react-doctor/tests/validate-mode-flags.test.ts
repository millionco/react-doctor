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
});
