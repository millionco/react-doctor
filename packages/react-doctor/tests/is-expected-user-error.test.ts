import { describe, expect, it } from "vite-plus/test";
import {
  AmbiguousProjectError,
  GitBaseBranchInvalid,
  GitBaseBranchMissing,
  NoReactDependencyError,
  NotADirectoryError,
  OxlintSpawnFailed,
  PackageJsonNotFoundError,
  ProjectNotFoundError,
  ReactDoctorError,
} from "@react-doctor/core";
import { CliInputError } from "../src/cli/utils/cli-input-error.js";
import { isExpectedUserError } from "../src/cli/utils/is-expected-user-error.js";

describe("isExpectedUserError", () => {
  it("classifies every project-discovery failure as an expected user error (kept out of Sentry)", () => {
    // Regression: running react-doctor against a directory with no React
    // (REACT-DOCTOR-1) or a path that doesn't exist (REACT-DOCTOR-4) is
    // expected, user-actionable behavior — not a crash to report.
    expect(isExpectedUserError(new NoReactDependencyError("/var/tmp"))).toBe(true);
    expect(isExpectedUserError(new ProjectNotFoundError("/tmp/audit-v7"))).toBe(true);
    expect(
      isExpectedUserError(new ProjectNotFoundError("/tmp/audit-v7", { kind: "missing-path" })),
    ).toBe(true);
    expect(isExpectedUserError(new PackageJsonNotFoundError("/var/tmp"))).toBe(true);
    expect(isExpectedUserError(new NotADirectoryError("/var/tmp/file.txt"))).toBe(true);
    expect(isExpectedUserError(new AmbiguousProjectError("/work", ["a", "b"]))).toBe(true);
  });

  it("classifies CLI invocation mistakes as expected user errors", () => {
    // REACT-DOCTOR-B/D/G/H: mutually exclusive flags, a malformed
    // "<file>:<line>" argument, or an unknown --project name are user
    // invocation mistakes, not crashes.
    expect(
      isExpectedUserError(new CliInputError("Cannot combine --staged and --diff; pick one mode.")),
    ).toBe(true);
    expect(
      isExpectedUserError(
        new CliInputError("Cannot combine --score and --json; pick one output mode."),
      ),
    ).toBe(true);
    expect(
      isExpectedUserError(new CliInputError('Expected "<file>:<line>", got "package.json".')),
    ).toBe(true);
  });

  it("classifies bad --diff base-branch input as an expected user error", () => {
    expect(
      isExpectedUserError(
        new ReactDoctorError({ reason: new GitBaseBranchInvalid({ detail: "bad ref" }) }),
      ),
    ).toBe(true);
    expect(
      isExpectedUserError(
        new ReactDoctorError({ reason: new GitBaseBranchMissing({ branch: "main" }) }),
      ),
    ).toBe(true);
  });

  it("does not mask genuine bugs (those stay reportable)", () => {
    expect(isExpectedUserError(new Error("boom"))).toBe(false);
    expect(isExpectedUserError(undefined)).toBe(false);
    expect(
      isExpectedUserError(
        new ReactDoctorError({ reason: new OxlintSpawnFailed({ cause: new Error("nope") }) }),
      ),
    ).toBe(false);
  });
});
