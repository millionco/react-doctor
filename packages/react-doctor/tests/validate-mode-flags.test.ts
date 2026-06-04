import { describe, expect, it } from "vite-plus/test";
import { validateModeFlags } from "../src/cli/utils/validate-mode-flags.js";

describe("validateModeFlags", () => {
  it("allows JSON mode to emit GitHub annotations on stderr", () => {
    expect(() => validateModeFlags({ json: true, annotations: true })).not.toThrow();
  });

  it("keeps score mode mutually exclusive with annotations", () => {
    expect(() => validateModeFlags({ score: true, annotations: true })).toThrow(
      "--annotations cannot be combined with --score.",
    );
  });

  it("keeps PR comment rendering mutually exclusive with JSON output", () => {
    expect(() => validateModeFlags({ json: true, prComment: true })).toThrow(
      "--pr-comment cannot be combined with --json or --score.",
    );
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
