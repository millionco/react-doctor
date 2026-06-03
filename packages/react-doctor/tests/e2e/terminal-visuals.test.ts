/**
 * End-to-end visual regression tests for the CLI's terminal output.
 *
 * Rather than scrubbing raw strings (which can't see ANSI escapes,
 * cursor moves, box-drawing or double-width glyphs), we replay the exact
 * byte stream the renderer emits through a headless xterm emulator sized
 * to a fixed terminal width. That tells us how the output *actually*
 * lays out — most importantly, whether any line is too wide for the
 * terminal and soft-wraps (the "visual overflow" failure mode).
 *
 * Two layers:
 *   1. In-process render of the score header + diagnostics with synthetic
 *      input — deterministic, no network, exercises the precise code we
 *      care about (top-errors block, code frames, score line).
 *   2. A real subprocess smoke test: spawn the built CLI against a fixture
 *      project and assert the rendered output is sane and doesn't overflow.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { OUTPUT_DETAIL_WRAP_WIDTH_CHARS } from "@react-doctor/core";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { printDiagnostics } from "../../src/cli/utils/render-diagnostics.js";
import { printFooter, printSummary } from "../../src/cli/utils/render-summary.js";
import { setupReactProject } from "../regressions/_helpers.js";
import { renderInTerminal } from "../helpers/render-in-terminal.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const builtCliPath = path.resolve(currentDirectory, "../../dist/cli.js");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-terminal-visuals-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const captureConsoleBytes = async (run: () => Promise<void>): Promise<string> => {
  const chunks: string[] = [];
  const consoleObject = globalThis.console as unknown as Record<string, unknown>;
  const originals = new Map<string, unknown>();
  const sink =
    (newlineTerminated: boolean) =>
    (...args: unknown[]) => {
      chunks.push(args.join(" ") + (newlineTerminated ? "\n" : ""));
    };
  for (const key of ["log", "info", "warn", "error"]) {
    originals.set(key, consoleObject[key]);
    consoleObject[key] = sink(true);
  }
  try {
    await run();
  } finally {
    for (const [key, original] of originals) consoleObject[key] = original;
  }
  // Normalize the verbose "Full diagnostics written to <dir>" temp path:
  // it's an absolute `os.tmpdir()` + UUID path whose LENGTH varies by OS
  // (macOS `/var/folders/…` ≈128 chars vs Linux `/tmp/…` ≈84), which would
  // make the overflow matrix env-dependent. Collapse it to a fixed token so
  // the snapshot reflects the real structural layout, not the runner's temp
  // dir.
  const normalized = chunks
    .join("")
    .replace(
      /\S*react-doctor-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      "/tmp/react-doctor-TEST",
    );
  // xterm needs CRLF to return the cursor to column 0; bare LF only moves down.
  return normalized.replace(/\n/g, "\r\n");
};

const SHARE_ONLY_PROJECT_NAME = "acme-super-long-workspace-package-name";

// Common real-world terminal widths to exercise: narrow split pane, the
// classic 80-column default, a modern editor terminal, a wide window, and
// an ultrawide. The matrix snapshot documents exactly which modes fit which.
const TERMINAL_WIDTHS = [60, 80, 100, 120, 160] as const;

// The widest a non-verbose structured line can get is the wrapped
// explanation budget (`OUTPUT_DETAIL_WRAP_WIDTH_CHARS`). Any terminal at
// least this wide must render the default surface without soft-wrapping.
const NON_VERBOSE_SAFE_WIDTHS = TERMINAL_WIDTHS.filter(
  (width) => width >= OUTPUT_DETAIL_WRAP_WIDTH_CHARS,
);

interface RenderScenario {
  readonly name: string;
  readonly verbose: boolean;
  readonly bytes: string;
}

describe("in-process render across terminal widths and render modes", () => {
  let scenarios: RenderScenario[];
  let defaultScenarioBytes: string;

  beforeAll(async () => {
    const projectDirectory = path.join(tempRoot, "synthetic");
    fs.mkdirSync(path.join(projectDirectory, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "src", "text-swap.tsx"),
      [
        "import { useState, useEffect } from 'react';",
        "export const TextSwap = ({ value }) => {",
        "  const [count, setCount] = useState(0);",
        "  useEffect(() => {",
        "    setCount(0);",
        "  }, [value]);",
        "  return count;",
        "};",
        "",
      ].join("\n"),
    );

    const makeDiagnostic = (
      rule: string,
      category: string,
      severity: "error" | "warning",
      line: number,
      message: string,
    ): Diagnostic =>
      ({
        filePath: "src/text-swap.tsx",
        plugin: "react-doctor",
        rule,
        severity,
        message,
        help: "",
        line,
        column: 5,
        category,
      }) as Diagnostic;

    const mixedDiagnostics: Diagnostic[] = [
      makeDiagnostic(
        "no-adjust-state-on-prop-change",
        "Bugs",
        "error",
        5,
        "State adjusted in a useEffect when a prop changes — forces an extra render with a stale UI between the two commits. Adjust the state during render with a `prev`-prop comparison instead, or refactor to remove the duplicated state.",
      ),
      makeDiagnostic(
        "no-adjust-state-on-prop-change",
        "Bugs",
        "error",
        5,
        "State adjusted in a useEffect when a prop changes.",
      ),
      makeDiagnostic(
        "no-nested-component-definition",
        "Maintainability",
        "error",
        2,
        "Component defined inside another component remounts on every render, throwing away its state and DOM.",
      ),
      makeDiagnostic(
        "no-array-index-key",
        "Bugs",
        "error",
        7,
        "Using the array index as a key breaks reconciliation when the list reorders.",
      ),
      makeDiagnostic(
        "rendering-hoist-jsx",
        "Performance",
        "warning",
        7,
        "This JSX element is constant and can be hoisted out of the component.",
      ),
    ];
    const warningsOnlyDiagnostics = mixedDiagnostics.filter(
      (diagnostic) => diagnostic.severity === "warning",
    );

    const renderScenarioBytes = (options: {
      diagnostics: Diagnostic[];
      scoreResult: ScoreResult | null;
      verbose: boolean;
    }): Promise<string> =>
      captureConsoleBytes(async () => {
        await Effect.runPromise(
          printDiagnostics(options.diagnostics, options.verbose, projectDirectory),
        );
        await Effect.runPromise(
          printSummary({
            diagnostics: options.diagnostics,
            elapsedMilliseconds: 1234,
            scoreResult: options.scoreResult,
            totalSourceFileCount: 1,
            noScoreMessage: "Score unavailable.",
            verbose: options.verbose,
          }),
        );
        await Effect.runPromise(
          printFooter({
            diagnostics: options.diagnostics,
            scoreResult: options.scoreResult,
            projectName: SHARE_ONLY_PROJECT_NAME,
            isOffline: true,
          }),
        );
      });

    const scenarioSpecs: {
      name: string;
      diagnostics: Diagnostic[];
      scoreResult: ScoreResult | null;
      verbose: boolean;
    }[] = [
      {
        name: "default-errors-great",
        diagnostics: mixedDiagnostics,
        scoreResult: { score: 99, label: "Great" },
        verbose: false,
      },
      {
        name: "default-errors-perfect",
        diagnostics: mixedDiagnostics,
        scoreResult: { score: 100, label: "Great" },
        verbose: false,
      },
      {
        name: "default-errors-ok",
        diagnostics: mixedDiagnostics,
        scoreResult: { score: 75, label: "OK" },
        verbose: false,
      },
      {
        name: "default-errors-needs-work",
        diagnostics: mixedDiagnostics,
        scoreResult: { score: 42, label: "Needs work" },
        verbose: false,
      },
      {
        name: "default-errors-no-score",
        diagnostics: mixedDiagnostics,
        scoreResult: null,
        verbose: false,
      },
      {
        name: "default-warnings-only",
        diagnostics: warningsOnlyDiagnostics,
        scoreResult: { score: 96, label: "Great" },
        verbose: false,
      },
      {
        name: "default-clean-perfect",
        diagnostics: [],
        scoreResult: { score: 100, label: "Great" },
        verbose: false,
      },
      {
        name: "verbose-errors-great",
        diagnostics: mixedDiagnostics,
        scoreResult: { score: 99, label: "Great" },
        verbose: true,
      },
    ];

    // Sequential, never Promise.all: captureConsoleBytes patches the global
    // console, so concurrent builds would clobber each other's sinks.
    scenarios = [];
    for (const spec of scenarioSpecs) {
      scenarios.push({
        name: spec.name,
        verbose: spec.verbose,
        bytes: await renderScenarioBytes(spec),
      });
    }
    defaultScenarioBytes =
      scenarios.find((scenario) => scenario.name === "default-errors-great")?.bytes ?? "";
  });

  it("renders a top errors block with an inline code frame (default mode)", async () => {
    // Assert against the emulator-rendered cell text, not the raw bytes:
    // `@babel/code-frame` syntax-highlights the frame whenever its
    // `supports-color` probe detects a color-capable env (it does in
    // GitHub Actions via `GITHUB_ACTIONS`, but not under a bare local
    // `CI=true`), which interleaves ANSI codes inside tokens like
    // `setCount(0)` and breaks a raw substring match. The terminal
    // emulator consumes those escapes and exposes the plain text the user
    // actually sees.
    const rendered = await renderInTerminal(defaultScenarioBytes, { cols: 120 });
    expect(rendered.text).toContain("errors you should fix");
    // The code frame caret line is the load-bearing visual element.
    expect(rendered.text).toContain("setCount(0)");
  });

  it("never leaks the project name into the header in any mode or width", async () => {
    for (const scenario of scenarios) {
      for (const cols of TERMINAL_WIDTHS) {
        const rendered = await renderInTerminal(scenario.bytes, { cols });
        for (const row of rendered.rows) {
          expect(row, `${scenario.name} @ ${cols}c`).not.toContain(SHARE_ONLY_PROJECT_NAME);
          expect(row, `${scenario.name} @ ${cols}c`).not.toContain("·");
        }
      }
    }
  });

  it("keeps the score line in the canonical `N / 100 Label` shape across scored modes", async () => {
    const scoredScenarios = scenarios.filter((scenario) => !scenario.name.includes("no-score"));
    for (const scenario of scoredScenarios) {
      const rendered = await renderInTerminal(scenario.bytes, { cols: 120 });
      const scoreRow = rendered.rows.find((row) => row.includes("/ 100"));
      expect(scoreRow, scenario.name).toBeDefined();
      expect(scoreRow, scenario.name).toMatch(/\d+ \/ 100 \S/);
    }
  });

  it("never overflows non-verbose modes at supported (>= wrap-budget) widths", async () => {
    const nonVerboseScenarios = scenarios.filter((scenario) => !scenario.verbose);
    for (const scenario of nonVerboseScenarios) {
      for (const cols of NON_VERBOSE_SAFE_WIDTHS) {
        const rendered = await renderInTerminal(scenario.bytes, { cols });
        expect(rendered.overflowed, `${scenario.name} @ ${cols}c`).toBe(false);
      }
    }
  });

  it("matches the terminal-width × mode overflow matrix", async () => {
    const columnHeader =
      "mode".padEnd(28) + TERMINAL_WIDTHS.map((width) => `${width}c`.padStart(7)).join("");
    const matrixLines = [columnHeader];
    for (const scenario of scenarios) {
      const cells: string[] = [];
      for (const cols of TERMINAL_WIDTHS) {
        const rendered = await renderInTerminal(scenario.bytes, { cols });
        cells.push((rendered.overflowed ? "wrap" : "ok").padStart(7));
      }
      matrixLines.push(scenario.name.padEnd(28) + cells.join(""));
    }
    expect(matrixLines.join("\n")).toMatchSnapshot();
  });

  it("matches the rendered 100-column layout snapshot", async () => {
    const rendered = await renderInTerminal(defaultScenarioBytes, { cols: 100 });
    // Normalize the category pointer: the renderer uses `›` on
    // unicode-capable terminals and falls back to `>` where unicode
    // isn't supported (Windows CI), so the raw glyph is platform-variable
    // and not what this layout snapshot is asserting.
    const platformStableLayout = rendered.logicalLines.join("\n").replaceAll("›", ">");
    expect(platformStableLayout).toMatchSnapshot();
  });
});

describe("non-verbose overflow summary line", () => {
  const overflowProjectDirectory = path.join(tempRoot, "overflow");

  const makeDiagnostic = (rule: string, severity: "error" | "warning", line: number): Diagnostic =>
    ({
      filePath: "src/x.tsx",
      plugin: "react-doctor",
      rule,
      severity,
      title: `${rule} title`,
      message: "Impact.",
      help: "Fix.",
      line,
      column: 1,
      category: "Bugs",
    }) as Diagnostic;

  const renderOverflowText = async (diagnostics: Diagnostic[]): Promise<string> => {
    const bytes = await captureConsoleBytes(() =>
      Effect.runPromise(printDiagnostics(diagnostics, false, overflowProjectDirectory)),
    );
    return (await renderInTerminal(bytes, { cols: 120 })).text;
  };

  // The category breakdown above the CTA carries the +N stats now (totals
  // per category, error/warning split). The CTA itself just answers "how do
  // I see each one individually?", so these tests focus on (a) when it
  // appears at all and (b) that it never echoes the redundant +N numbers
  // back at the reader.

  it("omits the --verbose pointer when every finding is already shown", async () => {
    const text = await renderOverflowText([
      makeDiagnostic("rule-a", "error", 1),
      makeDiagnostic("rule-b", "error", 2),
    ]);
    expect(text).not.toContain("--verbose");
    expect(text).not.toContain("to list every error and warning");
  });

  it("points at --verbose when a shown error rule hides extra sites", async () => {
    const text = await renderOverflowText([
      makeDiagnostic("rule-a", "error", 1),
      makeDiagnostic("rule-a", "error", 2),
    ]);
    expect(text).toContain("Run npx react-doctor@latest --verbose to list every error and warning");
  });

  it("shows the CTA when warnings are hidden from the top-errors detail", async () => {
    const text = await renderOverflowText([
      makeDiagnostic("hoist", "warning", 1),
      makeDiagnostic("hoist", "warning", 2),
      makeDiagnostic("hoist", "warning", 3),
    ]);
    expect(text).toContain("Run npx react-doctor@latest --verbose to list every error and warning");
  });

  it("never echoes the +N stats already shown in the category breakdown", async () => {
    const text = await renderOverflowText([
      makeDiagnostic("err-1", "error", 1),
      makeDiagnostic("err-2", "error", 2),
      makeDiagnostic("err-3", "error", 3),
      makeDiagnostic("err-4", "error", 4),
      makeDiagnostic("warn-1", "warning", 5),
      makeDiagnostic("warn-1", "warning", 6),
    ]);
    expect(text).toContain("Run npx react-doctor@latest --verbose to list every error and warning");
    expect(text).not.toContain("more rule");
    expect(text).not.toContain("optional warning");
  });
});

describe("multi-project code frames resolve against each project root", () => {
  it("renders the code frame for each diagnostic from its own project's source", async () => {
    const projectA = path.join(tempRoot, "multi-proj-a");
    const projectB = path.join(tempRoot, "multi-proj-b");
    fs.mkdirSync(path.join(projectA, "src"), { recursive: true });
    fs.mkdirSync(path.join(projectB, "src"), { recursive: true });
    // Same relative path in both projects, different contents — only a
    // per-diagnostic root resolver can render the right frame for each.
    fs.writeFileSync(
      path.join(projectA, "src", "widget.tsx"),
      ["before", "const FROM_PROJECT_A = 1;", "after", ""].join("\n"),
    );
    fs.writeFileSync(
      path.join(projectB, "src", "widget.tsx"),
      ["before", "const FROM_PROJECT_B = 2;", "after", ""].join("\n"),
    );

    const diagnosticA = {
      filePath: "src/widget.tsx",
      plugin: "react-doctor",
      rule: "no-adjust-state-on-prop-change",
      severity: "error",
      message: "Issue in project A.",
      help: "",
      line: 2,
      column: 7,
      category: "Bugs",
    } as Diagnostic;
    const diagnosticB = {
      ...diagnosticA,
      rule: "no-nested-component-definition",
      message: "Issue in project B.",
      category: "Maintainability",
    } as Diagnostic;

    const rootByDiagnostic = new WeakMap<Diagnostic, string>([
      [diagnosticA, projectA],
      [diagnosticB, projectB],
    ]);
    const resolveSourceRoot = (diagnostic: Diagnostic): string =>
      rootByDiagnostic.get(diagnostic) ?? "";

    const bytes = await captureConsoleBytes(async () => {
      await Effect.runPromise(
        printDiagnostics([diagnosticA, diagnosticB], false, resolveSourceRoot),
      );
    });
    const rendered = await renderInTerminal(bytes, { cols: 120 });

    expect(rendered.text).toContain("FROM_PROJECT_A");
    expect(rendered.text).toContain("FROM_PROJECT_B");
    expect(rendered.overflowed).toBe(false);
  });
});

const runCliInPipe = (
  args: string[],
  cwd: string,
): Promise<{ readonly stdout: string; readonly exitCode: number | null }> =>
  new Promise((resolve) => {
    const environment = { ...process.env, CI: "1", FORCE_COLOR: "0" };
    delete environment.NO_COLOR;
    const child = spawn(process.execPath, [builtCliPath, ...args], {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", () => {});
    child.on("close", (exitCode) => resolve({ stdout, exitCode }));
  });

const toTerminalStream = (text: string): string => text.replace(/\n/g, "\r\n");

const hasBuiltCli = fs.existsSync(builtCliPath);

describe.skipIf(!hasBuiltCli)("built CLI subprocess visual smoke", () => {
  let fixtureDirectory: string;

  beforeAll(() => {
    fixtureDirectory = setupReactProject(tempRoot, "subprocess-fixture", {
      files: {
        "src/counter.tsx": [
          "import { useState, useEffect } from 'react';",
          "export const Counter = ({ value }: { value: number }) => {",
          "  const [count, setCount] = useState(0);",
          "  useEffect(() => {",
          "    setCount(0);",
          "  }, [value]);",
          "  return <span>{count}</span>;",
          "};",
          "",
        ].join("\n"),
      },
    });
  });

  it("drives the real pipeline into a top-errors block with a code frame from the source file", async () => {
    const { stdout, exitCode } = await runCliInPipe(
      [fixtureDirectory, "--no-score", "--no-dead-code"],
      fixtureDirectory,
    );

    expect(typeof exitCode === "number").toBe(true);
    expect(stdout).toContain("React Doctor");
    expect(stdout).toContain("error you should fix");
    // The top-error headline shows the rule's human title (not the id).
    expect(stdout).toContain("State synced to a prop inside an effect");
    // The inline code frame is rendered from the actual fixture file.
    expect(stdout).toContain("src/counter.tsx:5");
    expect(stdout).toContain("setCount(0)");
  }, 60_000);

  it("renders the structured visual region without overflowing a 120-column terminal", async () => {
    const { stdout } = await runCliInPipe(
      [fixtureDirectory, "--no-score", "--no-dead-code"],
      fixtureDirectory,
    );

    // The free-form "Agent guidance" prose is intentionally long-form and
    // allowed to soft-wrap; the structured visuals above it (top errors,
    // code frame, category breakdown) must fit the terminal cleanly.
    const visualRegion = stdout.split("Agent guidance")[0];
    const rendered = await renderInTerminal(toTerminalStream(visualRegion), { cols: 120 });

    expect(rendered.text).toContain("error you should fix");
    expect(rendered.overflowed).toBe(false);
  }, 60_000);
});
