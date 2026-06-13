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

  it("rejects --scope combined with the deprecated --diff alias", () => {
    expect(() => validateModeFlags({ scope: "changed", diff: "main" })).toThrow(
      "Cannot combine --scope and --diff",
    );
  });

  it("rejects --staged with --scope full or changed (the index has no base branch)", () => {
    expect(() => validateModeFlags({ staged: true, scope: "full" })).toThrow(
      "Cannot combine --staged with --scope full",
    );
    expect(() => validateModeFlags({ staged: true, scope: "changed" })).toThrow(
      "Cannot combine --staged with --scope changed",
    );
  });

  it("allows --staged with --scope files or lines (composing source + granularity)", () => {
    expect(() => validateModeFlags({ staged: true, scope: "files" })).not.toThrow();
    expect(() => validateModeFlags({ staged: true, scope: "lines" })).not.toThrow();
    expect(() => validateModeFlags({ staged: true })).not.toThrow();
  });
});
