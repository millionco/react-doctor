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
});
