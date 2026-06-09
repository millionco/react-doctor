import * as Effect from "effect/Effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import {
  CI_ENVIRONMENT_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  CODING_AGENT_ENVIRONMENT_VARIABLES,
} from "../src/cli/utils/is-ci-environment.js";
import { printDiagnostics } from "../src/cli/utils/render-diagnostics.js";
import { animateScoreProjection } from "../src/cli/utils/render-score-header.js";
import { printSummary } from "../src/cli/utils/render-summary.js";
import { playWelcomeScene } from "../src/cli/utils/render-welcome.js";
import {
  canAnimateOnboarding,
  FORCE_ONBOARDING_ENV_VAR,
} from "../src/cli/utils/onboarding-pacing.js";

const makeDiagnostic = (
  category: string,
  severity: "error" | "warning",
  rule = `${category.toLowerCase()}-${severity}`,
): Diagnostic =>
  ({
    filePath: "src/App.tsx",
    plugin: "react-doctor",
    rule,
    severity,
    message: "State is reset after render, so users can see stale UI before React corrects it.",
    help: "Derive the value during render or remove the duplicated state.",
    line: 1,
    column: 1,
    category,
  }) as Diagnostic;

const ANSI = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, "g");
const stripAnsi = (text: string): string => text.replace(ANSI, "");

// Captures both sinks the renderers use: the static path prints via
// `Console.log` (→ console.log) while the animated path writes raw cursor
// controls straight to `process.stdout.write`.
const captureStdout = async (run: () => Promise<void>): Promise<string[]> => {
  const writes: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    writes.push(`${args.join(" ")}\n`);
  });
  const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
  try {
    await run();
  } finally {
    logSpy.mockRestore();
    writeSpy.mockRestore();
  }
  return writes;
};

describe("playWelcomeScene", () => {
  it("types the greeting in beside the happy face, then erases it", async () => {
    const writes = await captureStdout(() => Effect.runPromise(playWelcomeScene()));
    const output = writes.join("");
    expect(stripAnsi(output)).toContain("Welcome to React Doctor");
    // The tagline explains what React Doctor does, holds long enough to be
    // read, then the whole block is wiped before the scan starts.
    expect(stripAnsi(output)).toContain("I diagnose your React code");
    expect(output).toContain("◠ ◠");
    // Typewriter: many incremental frames, and an early partial reveal.
    expect(writes.length).toBeGreaterThan(20);
    expect(stripAnsi(writes[5] ?? "")).not.toContain("Welcome to React Doctor");
    // After the hold, the cursor moves up over the block (incl. the blank line)
    // and clears to the end of the screen.
    expect(output).toContain("\u001B[3A");
    expect(output).toContain("\u001B[0J");
  });

  it("clamps the tagline to the terminal width so it never soft-wraps", async () => {
    const NARROW_COLUMNS = 40;
    const previousColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    Object.defineProperty(process.stdout, "columns", {
      value: NARROW_COLUMNS,
      configurable: true,
    });
    try {
      const writes = await captureStdout(() => Effect.runPromise(playWelcomeScene()));
      // The full tagline is truncated with an ellipsis…
      const output = stripAnsi(writes.join(""));
      expect(output).toContain("…");
      expect(output).not.toContain("performance.");
      // …and no single typewriter frame's visible line is wide enough to wrap.
      for (const write of writes) {
        for (const segment of stripAnsi(write).split(/[\r\n]/)) {
          expect(segment.length).toBeLessThanOrEqual(NARROW_COLUMNS);
        }
      }
    } finally {
      if (previousColumns) {
        Object.defineProperty(process.stdout, "columns", previousColumns);
      } else {
        delete (process.stdout as unknown as { columns?: number }).columns;
      }
    }
  });
});

describe("printDiagnostics onboarding count-up", () => {
  const diagnostics = [
    makeDiagnostic("Bugs", "error"),
    makeDiagnostic("Bugs", "error"),
    makeDiagnostic("Performance", "error", "perf-1"),
  ];

  it("counts the category tallies up in place when animateCountUp is set", async () => {
    const writes = await captureStdout(() =>
      Effect.runPromise(
        printDiagnostics(diagnostics, false, ".", undefined, false, { animateCountUp: true }),
      ),
    );
    const output = writes.join("");
    // Redraw frames rewind over the category lines (2 categories → \x1b[2A).
    expect(output).toContain("\u001B[2A");
    // Lands on the real final tallies.
    const finalOutput = stripAnsi(output);
    expect(finalOutput).toContain("Bugs");
    expect(finalOutput).toContain("2 errors");
    expect(finalOutput).toContain("Performance");
  });

  it("prints the tallies flat (no cursor frames) when animateCountUp is off", async () => {
    const writes = await captureStdout(() =>
      Effect.runPromise(printDiagnostics(diagnostics, false, ".")),
    );
    expect(writes.join("")).not.toContain("\u001B[2A");
    expect(stripAnsi(writes.join(""))).toContain("2 errors");
  });
});

describe("printSummary onboarding projection", () => {
  it("grows the ghost gain (▓) when animateProjection is set", async () => {
    const scoreResult = { score: 20, label: "Critical" } as ScoreResult;
    const writes = await captureStdout(() =>
      Effect.runPromise(
        printSummary({
          diagnostics: [makeDiagnostic("Bugs", "error")],
          elapsedMilliseconds: 0,
          scoreResult,
          potentialScore: 60,
          totalSourceFileCount: 1,
          noScoreMessage: "",
          animateProjection: true,
        }),
      ),
    );
    const output = writes.join("");
    expect(stripAnsi(output)).toContain("You could improve");
    // The eased projection redraws the bar in place and reveals the ghost gain.
    expect(output).toContain("\u001B[5A");
    expect(output).toContain("▓");
  });
});

describe("score bar width", () => {
  it("clamps the score bar so the header fits a narrow terminal", async () => {
    const NARROW_COLUMNS = 60;
    const previousColumns = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    Object.defineProperty(process.stdout, "columns", {
      value: NARROW_COLUMNS,
      configurable: true,
    });
    try {
      const writes = await captureStdout(() =>
        Effect.runPromise(
          printSummary({
            diagnostics: [makeDiagnostic("Bugs", "error")],
            elapsedMilliseconds: 0,
            scoreResult: { score: 75, label: "OK" } as ScoreResult,
            totalSourceFileCount: 1,
            noScoreMessage: "",
          }),
        ),
      );
      const barLine = stripAnsi(writes.join(""))
        .split("\n")
        .find((line) => line.includes("█") && line.includes("░"));
      // The bar still renders (filled + empty), but the whole line now fits.
      expect(barLine).toBeDefined();
      expect((barLine ?? "").length).toBeLessThanOrEqual(NARROW_COLUMNS);
    } finally {
      if (previousColumns) {
        Object.defineProperty(process.stdout, "columns", previousColumns);
      } else {
        delete (process.stdout as unknown as { columns?: number }).columns;
      }
    }
  });
});

describe("animateScoreProjection", () => {
  it("grows the ghost gain segment in over multiple frames, redrawing in place", async () => {
    const scoreResult = { score: 20, label: "Critical" } as ScoreResult;
    const writes = await captureStdout(() =>
      Effect.runPromise(animateScoreProjection(scoreResult, 60, 5)),
    );
    const output = writes.join("");
    // Animated: many redraw frames, each jumping up to the bar and back.
    expect(writes.length).toBeGreaterThan(5);
    expect(output).toContain("\u001B[5A");
    expect(output).toContain("\u001B[5B");
    // The settled frame shows the projected gain (▓) in the bar.
    expect(stripAnsi(writes[writes.length - 1] ?? "")).toContain("▓");
  });

  it("is a no-op for a perfect score", async () => {
    const scoreResult = { score: 100, label: "Great" } as ScoreResult;
    const writes = await captureStdout(() =>
      Effect.runPromise(animateScoreProjection(scoreResult, 100, 5)),
    );
    expect(writes.join("")).toBe("");
  });
});

describe("canAnimateOnboarding", () => {
  const REAL_TTY = { isTTY: true, columns: 80 } as unknown as NodeJS.WriteStream;
  // Every env var that would mark the run CI/agent, so the suite is deterministic
  // no matter what shell it runs in.
  const MANAGED_ENV_VARS = [
    FORCE_ONBOARDING_ENV_VAR,
    "TERM",
    "CI",
    "GIT_DIR",
    ...CI_ENVIRONMENT_VARIABLES,
    ...CODING_AGENT_ENVIRONMENT_VARIABLES,
    ...CODING_AGENT_ENVIRONMENT_VALUE_VARIABLES,
  ];
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = {};
    for (const name of MANAGED_ENV_VARS) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
    process.env.TERM = "xterm-256color";
  });

  afterEach(() => {
    for (const name of MANAGED_ENV_VARS) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  });

  it("animates a plain interactive run on a real TTY", () => {
    expect(canAnimateOnboarding(REAL_TTY)).toBe(true);
  });

  it("animates a coding-agent terminal (e.g. Cursor) on a real TTY", () => {
    process.env.CURSOR_AGENT = "1";
    expect(canAnimateOnboarding(REAL_TTY)).toBe(true);
  });

  it("does not animate in CI", () => {
    process.env.CI = "true";
    expect(canAnimateOnboarding(REAL_TTY)).toBe(false);
  });

  it("does not animate inside a git hook (GIT_DIR) even on a real TTY", () => {
    process.env.GIT_DIR = "/repo/.git";
    expect(canAnimateOnboarding(REAL_TTY)).toBe(false);
  });

  it("animates a forced run even inside a git hook, on a real TTY", () => {
    process.env.GIT_DIR = "/repo/.git";
    process.env[FORCE_ONBOARDING_ENV_VAR] = "1";
    expect(canAnimateOnboarding(REAL_TTY)).toBe(true);
  });

  it("animates a forced run even in CI, on a real TTY", () => {
    process.env.CI = "true";
    process.env[FORCE_ONBOARDING_ENV_VAR] = "1";
    expect(canAnimateOnboarding(REAL_TTY)).toBe(true);
  });

  it("never animates a non-TTY stream (an agent capturing piped output)", () => {
    const pipe = { isTTY: false, columns: 0 } as unknown as NodeJS.WriteStream;
    expect(canAnimateOnboarding(pipe)).toBe(false);
    process.env[FORCE_ONBOARDING_ENV_VAR] = "1";
    expect(canAnimateOnboarding(pipe)).toBe(false);
  });
});
