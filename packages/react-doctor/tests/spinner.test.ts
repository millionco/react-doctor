import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { setSpinnerSilent, spinner } from "../src/cli/utils/spinner.js";

const ESC = String.fromCharCode(0x1b);
const ANSI_ESCAPE_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[A-Za-z]`, "g");
const CURSOR_UP_PATTERN = new RegExp(`${ESC}\\[1A`);
const ERASE_LINE_PATTERN = new RegExp(`${ESC}\\[0K`);

const stripAnsi = (input: string): string => input.replace(ANSI_ESCAPE_PATTERN, "");

describe("spinner static (non-interactive) mode", () => {
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;
  let writtenChunks: string[];
  let previousGitDir: string | undefined;

  beforeEach(() => {
    // `GIT_DIR` is the canonical "I'm inside a git hook" signal and
    // routes through `isSpinnerInteractive` to demote ora to one-shot
    // succeed/fail lines — same path #293 hits in real lefthook /
    // husky / pre-commit runs.
    previousGitDir = process.env.GIT_DIR;
    process.env.GIT_DIR = "/fake/.git";
    setSpinnerSilent(false);
    writtenChunks = [];
    stderrWriteSpy = vi.spyOn(process.stderr, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writtenChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
      return true;
    }) as typeof process.stderr.write);
  });

  afterEach(() => {
    stderrWriteSpy.mockRestore();
    if (previousGitDir === undefined) {
      delete process.env.GIT_DIR;
    } else {
      process.env.GIT_DIR = previousGitDir;
    }
  });

  // Regression guard for #293: in non-interactive contexts (Git pre-push
  // hooks, `script(1)`, etc.) the spinner must not emit cursor-up +
  // erase-line escapes, and a synchronous start+succeed pair must finish
  // in a single line so we don't double-print every project-detection
  // step or burn CPU in an unbounded re-render loop.
  it("emits exactly one symbol+text line per start/succeed cycle", () => {
    spinner("Detecting framework. Found Next.js.")
      .start()
      .succeed("Detecting framework. Found Next.js.");

    const cleanOutput = stripAnsi(writtenChunks.join(""));
    expect(cleanOutput).toContain("Detecting framework. Found Next.js.");
    // Exactly one terminating newline -> exactly one line.
    expect(cleanOutput.match(/\n/g) ?? []).toHaveLength(1);
    expect(writtenChunks.join("")).not.toMatch(CURSOR_UP_PATTERN);
    expect(writtenChunks.join("")).not.toMatch(ERASE_LINE_PATTERN);
  });

  it("emits exactly one line per fail() finalization", () => {
    spinner("Running lint checks...").start().fail("Lint checks failed.");

    const cleanOutput = stripAnsi(writtenChunks.join(""));
    expect(cleanOutput).toContain("Lint checks failed.");
    expect(cleanOutput).not.toContain("Running lint checks...");
    expect(cleanOutput.match(/\n/g) ?? []).toHaveLength(1);
  });

  it("does not animate: multiple sequential start+succeed calls each emit a single line", () => {
    spinner("step one").start().succeed("step one done");
    spinner("step two").start().succeed("step two done");
    spinner("step three").start().succeed("step three done");

    const cleanOutput = stripAnsi(writtenChunks.join(""));
    expect(cleanOutput).toContain("step one done");
    expect(cleanOutput).toContain("step two done");
    expect(cleanOutput).toContain("step three done");
    expect(cleanOutput.match(/\n/g) ?? []).toHaveLength(3);
  });

  it("succeed/fail are idempotent (calling twice still emits a single line)", () => {
    const handle = spinner("Installing skill...").start();
    handle.succeed("Installed.");
    handle.succeed("Installed.");
    handle.fail("Should be ignored.");

    const cleanOutput = stripAnsi(writtenChunks.join(""));
    expect(cleanOutput).toContain("Installed.");
    expect(cleanOutput).not.toContain("Should be ignored.");
    expect(cleanOutput.match(/\n/g) ?? []).toHaveLength(1);
  });

  it("silent mode suppresses all output, including in static mode", () => {
    setSpinnerSilent(true);
    try {
      spinner("noop").start().succeed("should be hidden");
    } finally {
      setSpinnerSilent(false);
    }
    expect(writtenChunks.join("")).toBe("");
  });
});
