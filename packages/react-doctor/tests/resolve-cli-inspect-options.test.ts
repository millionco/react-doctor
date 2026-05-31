import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { resolveCliInspectOptions } from "../src/cli/utils/resolve-cli-inspect-options.js";

const CI_ENVIRONMENT_VARIABLES = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI"] as const;

describe("resolveCliInspectOptions: CI behavior (issue #302)", () => {
  let savedEnvironment: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnvironment = {};
    for (const envVariable of CI_ENVIRONMENT_VARIABLES) {
      savedEnvironment[envVariable] = process.env[envVariable];
      delete process.env[envVariable];
    }
  });

  afterEach(() => {
    for (const envVariable of CI_ENVIRONMENT_VARIABLES) {
      const previousValue = savedEnvironment[envVariable];
      if (previousValue === undefined) {
        delete process.env[envVariable];
      } else {
        process.env[envVariable] = previousValue;
      }
    }
  });

  it("does not auto-disable scoring in CI; the score path still runs", () => {
    process.env.GITHUB_ACTIONS = "true";

    const resolved = resolveCliInspectOptions({}, null);

    expect(resolved.noScore).toBe(false);
    expect(resolved.isCi).toBe(true);
  });

  it("respects an explicit user opt-out (CLI flag or config) in CI", () => {
    process.env.GITHUB_ACTIONS = "true";

    expect(resolveCliInspectOptions({ score: false }, null).noScore).toBe(true);
    expect(resolveCliInspectOptions({}, { noScore: true }).noScore).toBe(true);
  });

  it("leaves isCi false outside CI", () => {
    expect(resolveCliInspectOptions({}, null).isCi).toBe(false);
  });

  it("detects GITHUB_ACTIONS, GITLAB_CI, and CIRCLECI", () => {
    for (const envVariable of ["GITHUB_ACTIONS", "GITLAB_CI", "CIRCLECI"] as const) {
      process.env[envVariable] = "true";
      expect(resolveCliInspectOptions({}, null).isCi).toBe(true);
      delete process.env[envVariable];
    }
  });
});

describe("resolveCliInspectOptions: warnings vs --fail-on", () => {
  it("leaves warnings unset by default (hidden via the inspect() default)", () => {
    expect(resolveCliInspectOptions({}, null).warnings).toBeUndefined();
  });

  it("forces warnings on for --fail-on warning (flag or config) so the gate can fire", () => {
    expect(resolveCliInspectOptions({ failOn: "warning" }, null).warnings).toBe(true);
    expect(resolveCliInspectOptions({}, { failOn: "warning" }).warnings).toBe(true);
  });

  it("does not set warnings when failing on errors", () => {
    expect(resolveCliInspectOptions({ failOn: "error" }, null).warnings).toBeUndefined();
  });

  it("respects an explicit --no-warnings even with --fail-on warning", () => {
    expect(resolveCliInspectOptions({ failOn: "warning", warnings: false }, null).warnings).toBe(
      false,
    );
  });

  it("respects an explicit --warnings", () => {
    expect(resolveCliInspectOptions({ warnings: true }, null).warnings).toBe(true);
  });
});
