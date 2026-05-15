import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { shouldSkipPrompts } from "../src/cli/utils/should-skip-prompts.js";

interface ProcessStdinTtyHandle {
  restore: () => void;
}

const stubProcessStdinIsTty = (value: boolean): ProcessStdinTtyHandle => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  Object.defineProperty(process.stdin, "isTTY", { value, configurable: true });
  return {
    restore: () => {
      if (originalDescriptor) {
        Object.defineProperty(process.stdin, "isTTY", originalDescriptor);
      } else {
        delete (process.stdin as unknown as { isTTY?: boolean }).isTTY;
      }
    },
  };
};

// The env vars `isNonInteractiveEnvironment()` consults. Cleared at the
// start of each test so the helper's result depends only on what the
// individual test sets.
const NON_INTERACTIVE_ENV_VARS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "BUILDKITE",
  "JENKINS_URL",
  "TF_BUILD",
  "CODEBUILD_BUILD_ID",
  "TEAMCITY_VERSION",
  "BITBUCKET_BUILD_NUMBER",
  "CIRCLECI",
  "TRAVIS",
  "DRONE",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CURSOR_AGENT",
  "CODEX_CI",
  "OPENCODE",
  "AMP_HOME",
] as const;

describe("shouldSkipPrompts", () => {
  let savedEnv: Record<string, string | undefined>;
  let ttyHandle: ProcessStdinTtyHandle;

  beforeEach(() => {
    savedEnv = {};
    for (const envVarName of NON_INTERACTIVE_ENV_VARS) {
      savedEnv[envVarName] = process.env[envVarName];
      delete process.env[envVarName];
    }
    ttyHandle = stubProcessStdinIsTty(true);
  });

  afterEach(() => {
    for (const envVarName of NON_INTERACTIVE_ENV_VARS) {
      const previousValue = savedEnv[envVarName];
      if (previousValue === undefined) {
        delete process.env[envVarName];
      } else {
        process.env[envVarName] = previousValue;
      }
    }
    ttyHandle.restore();
  });

  it("returns false with an interactive TTY and no other signals", () => {
    expect(shouldSkipPrompts()).toBe(false);
  });

  it("returns true when --yes is set", () => {
    expect(shouldSkipPrompts({ yes: true })).toBe(true);
  });

  it("returns true when --full is set (inspect path)", () => {
    expect(shouldSkipPrompts({ full: true })).toBe(true);
  });

  it("returns true when --json is set (inspect path)", () => {
    expect(shouldSkipPrompts({ json: true })).toBe(true);
  });

  it("returns true when stdin is not a TTY", () => {
    ttyHandle.restore();
    ttyHandle = stubProcessStdinIsTty(false);
    expect(shouldSkipPrompts()).toBe(true);
  });

  // Regression guard for H1: install command must respect CI env vars even
  // when stdin is attached to a TTY. Without `isNonInteractiveEnvironment()`
  // in shouldSkipPrompts, this would return false and the install command
  // would hang on the agent-selection prompt in CI runners that allocate
  // a pseudo-TTY (e.g. `act`, GitHub Actions with `tty: true`).
  it("returns true when CI env var is set, even with an interactive TTY", () => {
    process.env.CI = "true";
    expect(shouldSkipPrompts()).toBe(true);
  });

  it("returns true when CLAUDECODE env var is set (agent shell)", () => {
    process.env.CLAUDECODE = "1";
    expect(shouldSkipPrompts()).toBe(true);
  });

  it("returns true when CURSOR_AGENT env var is set (agent shell)", () => {
    process.env.CURSOR_AGENT = "1";
    expect(shouldSkipPrompts()).toBe(true);
  });
});
