import { describe, expect, it } from "vite-plus/test";
import {
  AmbiguousProject,
  ConfigParseFailed,
  DeadCodeAnalysisFailed,
  formatReactDoctorError,
  GitBaseBranchInvalid,
  GitBaseBranchMissing,
  GitInvocationFailed,
  isReactDoctorError,
  isSplittableReactDoctorError,
  isUserInputError,
  NoReactDependency,
  OxlintBatchExceeded,
  OxlintOutputUnparseable,
  OxlintSpawnFailed,
  OxlintUnavailable,
  ProjectNotFound,
  ReactDoctorError,
} from "@react-doctor/core";

describe("ReactDoctorError leaves", () => {
  it("OxlintUnavailable renders binary-not-found", () => {
    const error = new ReactDoctorError({
      reason: new OxlintUnavailable({
        kind: "binary-not-found",
        detail: "/path/to/oxlint",
      }),
    });
    expect(error.reason._tag).toBe("OxlintUnavailable");
    expect(formatReactDoctorError(error)).toBe("oxlint binary not found: /path/to/oxlint");
  });

  it("OxlintUnavailable renders native-binding-missing", () => {
    const error = new ReactDoctorError({
      reason: new OxlintUnavailable({
        kind: "native-binding-missing",
        detail: "no @oxlint/linux-x64 in node_modules",
      }),
    });
    expect(formatReactDoctorError(error)).toBe(
      "oxlint native binding missing: no @oxlint/linux-x64 in node_modules",
    );
  });

  it("OxlintBatchExceeded renders each kind", () => {
    const cases: Array<{
      kind: "timeout" | "output-too-large" | "oom" | "killed";
      expected: string;
    }> = [
      { kind: "timeout", expected: "oxlint batch timed out: 60s budget exceeded" },
      { kind: "output-too-large", expected: "oxlint batch output exceeded limit: 50 MiB cap" },
      { kind: "oom", expected: "oxlint batch ran out of memory: SIGABRT" },
      { kind: "killed", expected: "oxlint batch was killed: SIGKILL" },
    ];
    const details: Record<string, string> = {
      timeout: "60s budget exceeded",
      "output-too-large": "50 MiB cap",
      oom: "SIGABRT",
      killed: "SIGKILL",
    };
    for (const { kind, expected } of cases) {
      const error = new ReactDoctorError({
        reason: new OxlintBatchExceeded({ kind, detail: details[kind] ?? "" }),
      });
      expect(formatReactDoctorError(error)).toBe(expected);
    }
  });

  it("OxlintSpawnFailed wraps an underlying cause", () => {
    const inner = new Error("ENOENT: spawn oxlint");
    const error = new ReactDoctorError({
      reason: new OxlintSpawnFailed({ cause: inner }),
    });
    expect(formatReactDoctorError(error)).toContain("Failed to run oxlint");
    expect(formatReactDoctorError(error)).toContain("ENOENT: spawn oxlint");
  });

  it("OxlintOutputUnparseable surfaces the preview", () => {
    const error = new ReactDoctorError({
      reason: new OxlintOutputUnparseable({ preview: "<html>500 internal</html>" }),
    });
    expect(formatReactDoctorError(error)).toBe(
      "Failed to parse oxlint output: <html>500 internal</html>",
    );
  });

  it("ConfigParseFailed names the path + cause", () => {
    const error = new ReactDoctorError({
      reason: new ConfigParseFailed({
        path: "/repo/react-doctor.config.json",
        cause: new SyntaxError("Unexpected token }"),
      }),
    });
    expect(formatReactDoctorError(error)).toContain("/repo/react-doctor.config.json");
    expect(formatReactDoctorError(error)).toContain("Unexpected token }");
  });

  it("ProjectNotFound names the directory", () => {
    const error = new ReactDoctorError({
      reason: new ProjectNotFound({ directory: "/repo/apps/web" }),
    });
    expect(formatReactDoctorError(error)).toBe("Could not find a React project at /repo/apps/web");
  });

  it("NoReactDependency names the directory", () => {
    const error = new ReactDoctorError({
      reason: new NoReactDependency({ directory: "/repo/packages/utils" }),
    });
    expect(formatReactDoctorError(error)).toBe("No React dependency found in /repo/packages/utils");
  });

  it("AmbiguousProject lists the candidates", () => {
    const error = new ReactDoctorError({
      reason: new AmbiguousProject({
        directory: "/repo",
        candidates: ["apps/web", "apps/admin"],
      }),
    });
    expect(formatReactDoctorError(error)).toBe(
      "Ambiguous project at /repo: found 2 candidates (apps/web, apps/admin)",
    );
  });

  it("DeadCodeAnalysisFailed wraps the cause", () => {
    const error = new ReactDoctorError({
      reason: new DeadCodeAnalysisFailed({ cause: "SIGABRT from native binding" }),
    });
    expect(formatReactDoctorError(error)).toContain("Dead-code analysis failed");
    expect(formatReactDoctorError(error)).toContain("SIGABRT from native binding");
  });
});

describe("isReactDoctorError", () => {
  it("returns true for a wrapped tagged error", () => {
    const error = new ReactDoctorError({
      reason: new ProjectNotFound({ directory: "/repo" }),
    });
    expect(isReactDoctorError(error)).toBe(true);
  });

  it("returns false for plain Errors", () => {
    expect(isReactDoctorError(new Error("not tagged"))).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isReactDoctorError("string")).toBe(false);
    expect(isReactDoctorError(null)).toBe(false);
    expect(isReactDoctorError(undefined)).toBe(false);
    expect(isReactDoctorError({ _tag: "ReactDoctorError" })).toBe(false);
  });
});

describe("isSplittableReactDoctorError", () => {
  it("returns true only for OxlintBatchExceeded", () => {
    const splittable = new ReactDoctorError({
      reason: new OxlintBatchExceeded({ kind: "timeout", detail: "60s" }),
    });
    expect(isSplittableReactDoctorError(splittable)).toBe(true);
  });

  it("returns false for other reasons", () => {
    const cases = [
      new OxlintUnavailable({ kind: "binary-not-found", detail: "x" }),
      new OxlintSpawnFailed({ cause: new Error("boom") }),
      new OxlintOutputUnparseable({ preview: "x" }),
      new ConfigParseFailed({ path: "x", cause: "x" }),
      new ProjectNotFound({ directory: "x" }),
      new NoReactDependency({ directory: "x" }),
      new AmbiguousProject({ directory: "x", candidates: [] }),
      new DeadCodeAnalysisFailed({ cause: "x" }),
    ] as const;
    for (const reason of cases) {
      const error = new ReactDoctorError({ reason });
      expect(isSplittableReactDoctorError(error)).toBe(false);
    }
  });

  it("returns false for non-ReactDoctorError values", () => {
    expect(isSplittableReactDoctorError(new Error("plain"))).toBe(false);
    expect(isSplittableReactDoctorError("string")).toBe(false);
    expect(isSplittableReactDoctorError(null)).toBe(false);
  });
});

describe("isUserInputError", () => {
  it("returns true for diff-base reasons the user can fix", () => {
    const cases = [
      new GitBaseBranchInvalid({ detail: "bad ref" }),
      new GitBaseBranchMissing({ branch: "origin/missing" }),
    ] as const;
    for (const reason of cases) {
      expect(isUserInputError(new ReactDoctorError({ reason }))).toBe(true);
    }
  });

  it("returns false for genuine bugs (so they still reach Sentry)", () => {
    const cases = [
      new GitInvocationFailed({ args: ["diff"], directory: "/repo", cause: new Error("boom") }),
      new OxlintSpawnFailed({ cause: new Error("boom") }),
      new ProjectNotFound({ directory: "/repo" }),
    ] as const;
    for (const reason of cases) {
      expect(isUserInputError(new ReactDoctorError({ reason }))).toBe(false);
    }
  });

  it("returns false for non-ReactDoctorError values", () => {
    expect(isUserInputError(new Error("plain"))).toBe(false);
    expect(isUserInputError("string")).toBe(false);
    expect(isUserInputError(null)).toBe(false);
  });
});
