import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { isSpinnerInteractive } from "../src/cli/utils/is-spinner-interactive.js";

interface StreamStubHandle {
  restore: () => void;
}

const stubStream = (
  stream: NodeJS.WriteStream,
  overrides: Partial<{ isTTY: boolean; columns: number }>,
): StreamStubHandle => {
  const previousIsTty = Object.getOwnPropertyDescriptor(stream, "isTTY");
  const previousColumns = Object.getOwnPropertyDescriptor(stream, "columns");

  if ("isTTY" in overrides) {
    Object.defineProperty(stream, "isTTY", {
      value: overrides.isTTY,
      configurable: true,
    });
  }
  if ("columns" in overrides) {
    Object.defineProperty(stream, "columns", {
      value: overrides.columns,
      configurable: true,
    });
  }

  return {
    restore: () => {
      if (previousIsTty) {
        Object.defineProperty(stream, "isTTY", previousIsTty);
      } else {
        delete (stream as unknown as { isTTY?: boolean }).isTTY;
      }
      if (previousColumns) {
        Object.defineProperty(stream, "columns", previousColumns);
      } else {
        delete (stream as unknown as { columns?: number }).columns;
      }
    },
  };
};

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
  "GIT_DIR",
  "TERM",
] as const;

describe("isSpinnerInteractive", () => {
  let savedEnv: Record<string, string | undefined>;
  let stderrHandle: StreamStubHandle;
  let stdoutHandle: StreamStubHandle;

  beforeEach(() => {
    savedEnv = {};
    for (const envVarName of NON_INTERACTIVE_ENV_VARS) {
      savedEnv[envVarName] = process.env[envVarName];
      delete process.env[envVarName];
    }
    stderrHandle = stubStream(process.stderr, { isTTY: true, columns: 80 });
    stdoutHandle = stubStream(process.stdout, { isTTY: true, columns: 80 });
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
    stdoutHandle.restore();
    stderrHandle.restore();
  });

  it("returns true on a fully interactive stderr TTY with sensible columns", () => {
    expect(isSpinnerInteractive()).toBe(true);
  });

  it("returns false when stderr is not a TTY", () => {
    stderrHandle.restore();
    stderrHandle = stubStream(process.stderr, { isTTY: false, columns: 80 });
    expect(isSpinnerInteractive()).toBe(false);
  });

  // Regression guard for #293: under `script(1)` and Git pre-push hooks
  // the stream ora renders to inherits a TTY but `columns` is reported
  // as 0/undefined. Without this check, ora's render loop computes
  // `Math.ceil(width / 0) === Infinity` lines to clear and emits
  // unbounded cursor-up + erase-line escapes (99% CPU, never returns).
  it("returns false when columns is 0 (e.g. under `script(1)` / Git hooks)", () => {
    stderrHandle.restore();
    stderrHandle = stubStream(process.stderr, { isTTY: true, columns: 0 });
    expect(isSpinnerInteractive()).toBe(false);
  });

  it("returns false when columns is undefined", () => {
    stderrHandle.restore();
    stderrHandle = stubStream(process.stderr, {
      isTTY: true,
      columns: undefined as unknown as number,
    });
    expect(isSpinnerInteractive()).toBe(false);
  });

  // Regression guard for the React Review P1 on PR #296: the guard must
  // consult the same stream ora renders to (stderr by default), not
  // stdout. Otherwise the hang reappears any time stderr is the TTY with
  // 0/undefined columns while stdout is healthy (a Git pre-push hook
  // where stdout is piped to the hook runner but stderr inherits the
  // parent TTY).
  it("returns false based on stderr, not stdout, when called with no argument", () => {
    stderrHandle.restore();
    stderrHandle = stubStream(process.stderr, { isTTY: true, columns: 0 });
    // stdout is still healthy in beforeEach.
    expect(isSpinnerInteractive()).toBe(false);
  });

  it("accepts an explicit stream argument and checks that one", () => {
    stderrHandle.restore();
    stderrHandle = stubStream(process.stderr, { isTTY: false, columns: 80 });
    // stdout is healthy, so when we explicitly pass it we should pass.
    expect(isSpinnerInteractive(process.stdout)).toBe(true);
  });

  it("returns false when TERM is `dumb`", () => {
    process.env.TERM = "dumb";
    expect(isSpinnerInteractive()).toBe(false);
  });

  it("returns false when CI env var is set, even on a TTY", () => {
    process.env.CI = "true";
    expect(isSpinnerInteractive()).toBe(false);
  });

  it("returns false when CURSOR_AGENT env var is set", () => {
    process.env.CURSOR_AGENT = "1";
    expect(isSpinnerInteractive()).toBe(false);
  });

  // Regression guard for #293's primary trigger: lefthook/husky/etc.
  // hook scripts run with `GIT_DIR` set by git itself (per
  // `git-hooks(5)`). This catches every git-hook manager at once
  // without needing per-tool env vars.
  it("returns false when GIT_DIR is set (git hook execution)", () => {
    process.env.GIT_DIR = "/repo/.git";
    expect(isSpinnerInteractive()).toBe(false);
  });
});
