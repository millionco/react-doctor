import { describe, expect, it } from "vite-plus/test";
import {
  validateIncludeUntrackedScope,
  validateModeFlags,
} from "../src/cli/utils/validate-mode-flags.js";

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

  it("rejects --debug combined with --no-score or --no-telemetry (the trace it needs is off)", () => {
    expect(() => validateModeFlags({ debug: true, score: false })).toThrow(
      "Cannot combine --debug with --no-score",
    );
    expect(() => validateModeFlags({ debug: true, telemetry: false })).toThrow(
      "Cannot combine --debug with --no-telemetry",
    );
  });

  it("allows --debug on its own", () => {
    expect(() => validateModeFlags({ debug: true })).not.toThrow();
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

  it("rejects --include-untracked with --staged (the index has no untracked files)", () => {
    expect(() =>
      validateModeFlags({ includeUntracked: true, staged: true, scope: "files" }),
    ).toThrow("Cannot combine --include-untracked with --staged");
  });
});

describe("validateIncludeUntrackedScope", () => {
  it("is a no-op when --include-untracked is off (any scope)", () => {
    expect(() => validateIncludeUntrackedScope(false, undefined)).not.toThrow();
    expect(() => validateIncludeUntrackedScope(false, "full")).not.toThrow();
  });

  it("rejects --include-untracked without a working-tree scope in effect", () => {
    expect(() => validateIncludeUntrackedScope(true, undefined)).toThrow(
      "--include-untracked requires the files, changed, or lines scope",
    );
    expect(() => validateIncludeUntrackedScope(true, "full")).toThrow(
      "--include-untracked requires the files, changed, or lines scope",
    );
  });

  it("allows --include-untracked with a resolved working-tree scope (from flag or config)", () => {
    expect(() => validateIncludeUntrackedScope(true, "files")).not.toThrow();
    expect(() => validateIncludeUntrackedScope(true, "changed")).not.toThrow();
    expect(() => validateIncludeUntrackedScope(true, "lines")).not.toThrow();
  });
});
