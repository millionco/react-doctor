import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { GITHUB_ACTIONS_SETUP_URL } from "@react-doctor/core";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import figures from "figures";
import {
  TUI_DEFAULT_TERMINAL_COLUMNS,
  TUI_REPORT_COMPACT_MAX_ROWS,
  TUI_REPORT_STACKED_MAX_LIST_ROWS,
  TUI_REPORT_STATUS_ROWS,
  TUI_REPORT_VIEWPORT_MARGIN_ROWS,
} from "../../src/cli/utils/constants.js";
import * as launchAgent from "../../src/cli/utils/launch-agent.js";
import * as openUrlModule from "../../src/cli/utils/open-url.js";
import { ScanApp } from "../../src/cli/ink/scan-app.js";
import { createScanStore } from "../../src/cli/ink/scan-store.js";
import { severityVariant } from "../../src/cli/ink/lib/severity-variants.js";

const makeDiagnostic = (overrides: Partial<Diagnostic>): Diagnostic => ({
  filePath: "src/Profile.tsx",
  plugin: "react-doctor",
  rule: "no-derived-state-effect",
  severity: "warning",
  message: "Your users briefly see stale state on every prop change.",
  help: "",
  line: 1,
  column: 1,
  category: "State & Effects",
  ...overrides,
});

const SCORE: ScoreResult = { score: 72, label: "Fair" };

interface TerminalStdout {
  readonly emit: (event: string) => void;
}

interface TerminalDimensions {
  readonly columns?: number;
  readonly rows?: number;
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

const resizeTerminal = (stdout: TerminalStdout, dimensions: TerminalDimensions): void => {
  if (dimensions.columns !== undefined) {
    Object.defineProperty(stdout, "columns", {
      get: () => dimensions.columns,
      configurable: true,
    });
  }
  if (dimensions.rows !== undefined) {
    Object.defineProperty(stdout, "rows", {
      get: () => dimensions.rows,
      configurable: true,
    });
  }
  stdout.emit("resize");
};

afterEach(() => vi.restoreAllMocks());

describe("ScanApp", () => {
  it("renders the live scan view before a report settles", () => {
    const store = createScanStore();
    store.setProgress("Linting source files");
    store.emitDiagnostic(makeDiagnostic({ rule: "rules-of-hooks", severity: "error" }));

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Linting source files");
    expect(frame).toContain("1 found");
    unmount();
  });

  it("renders repeated live diagnostics without duplicate React keys", () => {
    const store = createScanStore();
    const repeatedDiagnostic = makeDiagnostic({
      filePath: "package.json",
      plugin: "deslop",
      rule: "unused-dev-dependency",
      line: 0,
      column: 0,
    });
    store.emitDiagnostic(repeatedDiagnostic);
    store.emitDiagnostic(repeatedDiagnostic);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = render(<ScanApp store={store} />);

    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    unmount();
  });

  it("renders the score and actions before opening the sorted issue list", async () => {
    const store = createScanStore();
    const diagnostics = [
      makeDiagnostic({ rule: "rules-of-hooks", severity: "error", category: "Correctness" }),
      makeDiagnostic({
        rule: "no-array-index-key",
        category: "Correctness",
        filePath: "src/Cart.tsx",
        line: 9,
      }),
      makeDiagnostic({
        rule: "no-array-index-key",
        category: "Correctness",
        filePath: "src/List.tsx",
        line: 4,
      }),
    ];
    store.setReport({
      diagnostics,
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 12,
      elapsedMilliseconds: 1234,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { frames, lastFrame, stdin, stdout, unmount } = render(<ScanApp store={store} />);
    await flush();
    resizeTerminal(stdout, {
      rows: TUI_REPORT_COMPACT_MAX_ROWS + TUI_REPORT_STATUS_ROWS,
    });
    await vi.waitFor(() => {
      expect(lastFrame() ?? "").toContain("┌─────┐");
    });
    const frame = lastFrame() ?? "";
    expect(frame).toContain("72");
    expect(frame).toContain("demo-app");
    expect(frame).toContain("React Doctor");
    expect(frame).toContain("┌─────┐");
    expect(frame).toContain(`${figures.pointer} Review 2 issues`);
    expect(frame).not.toContain("Top 1 error to review first");
    expect(frame).not.toContain("Why Your users briefly see stale state on every prop");
    const frameLines = frame.split("\n");
    const scoreBarIndex = frameLines.findIndex((line) => line.includes("█"));
    expect(frameLines[scoreBarIndex + 1]).toContain("React Doctor (https://react.doctor)");

    const viewerFrameStart = frames.length;
    stdin.write("\r");
    await flush();
    const issueFrame = lastFrame() ?? "";
    const unreadFrames = frames
      .slice(viewerFrameStart)
      .filter((frame) => frame.includes("issue unread"));
    expect(unreadFrames.length).toBeGreaterThan(0);
    expect(unreadFrames.every((frame) => frame.includes("1 issue unread"))).toBe(true);
    expect(issueFrame).toContain("Correctness");
    expect(issueFrame).toContain(`› ${severityVariant("error").icon} react-doctor/rules-of-hooks`);
    expect(issueFrame).toContain("react-doctor/rules-of-hooks");
    expect(issueFrame).toContain("Correctness · error");
    expect(issueFrame).toContain("×2");
    unmount();
  });

  it("keeps detailed findings out of the landing screen", async () => {
    const store = createScanStore();
    const diagnostics = Array.from({ length: 4 }, (_, diagnosticIndex) =>
      makeDiagnostic({
        rule: `preview-rule-${diagnosticIndex}`,
        title: `Preview error ${diagnosticIndex}`,
        severity: "error",
        filePath: "src/cli/ink/scan-app.tsx",
        line: diagnosticIndex + 1,
      }),
    );
    store.setReport({
      diagnostics,
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: process.cwd(),
      scannedFileCount: diagnostics.length,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, stdout, unmount } = render(<ScanApp store={store} />);
    expect(lastFrame()).not.toContain("Top 3 errors to review first");
    expect(lastFrame()).not.toContain("src/cli/ink/scan-app.tsx:1");

    resizeTerminal(stdout, { columns: 160, rows: 30 });
    await flush();
    stdin.write("\r");
    await flush();
    expect(lastFrame()).toContain("Preview error 0");
    expect(lastFrame()).toContain("src/cli/ink/scan-app.tsx:1");
    unmount();
  });

  it("shows the score projection before category details in the viewer", async () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [
        makeDiagnostic({ rule: "rules-of-hooks", severity: "error", category: "Correctness" }),
        makeDiagnostic({ rule: "no-array-index-key", severity: "warning", category: "Bugs" }),
      ],
      score: SCORE,
      projectedScore: 88,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 3,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, stdout, unmount } = render(<ScanApp store={store} />);
    await flush();
    resizeTerminal(stdout, { rows: 30 });
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Potential score 88 after priority fixes +16");
    expect(frame).not.toContain("Correctness: react-doctor/rules-of-hooks");
    expect(frame).not.toContain("Bugs");
    stdin.write("\r");
    await flush();
    expect(lastFrame()).toContain("Correctness");
    expect(lastFrame()).toContain("Bugs");
    unmount();
  });

  it("renders the no-score header when the score is unavailable", () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: null,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score disabled by --no-score.",
    });

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    expect(lastFrame() ?? "").toContain("Score disabled by --no-score.");
    unmount();
  });

  it("does not show a clean state when lint hard-fails", () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [],
      score: null,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
      lintFailureReason: "Oxlint failed.",
    });

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    expect(lastFrame()).toContain("Lint did not run: Oxlint failed.");
    expect(lastFrame()).not.toContain("No issues found");
    unmount();
  });

  it("does not show a clean state when a non-lint check is incomplete", () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [],
      score: null,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
      skippedChecks: ["dead-code"],
    });

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    expect(lastFrame()).toContain(
      "No issues detected, but dead-code checks failed — results are incomplete.",
    );
    expect(lastFrame()).not.toContain("No issues found");
    unmount();
  });

  it("renders a flat monorepo summary: aggregate score, combined list, folder-qualified paths", async () => {
    const store = createScanStore();
    const webScore: ScoreResult = {
      score: 58,
      label: "Needs work",
      rules: { "react-doctor/rules-of-hooks": { priority: 10, tier: "P3" } },
    };
    const apiScore: ScoreResult = {
      score: 91,
      label: "Great",
      rules: { "react-doctor/no-array-index-key": { priority: 90, tier: "P0" } },
    };
    const webReport = {
      diagnostics: [
        makeDiagnostic({
          rule: "rules-of-hooks",
          severity: "error",
          filePath: "apps/web/src/Profile.tsx",
        }),
      ],
      score: webScore,
      projectedScore: null,
      projectName: "web",
      rootDirectory: "/tmp/repo/apps/web",
      scannedFileCount: 4,
      elapsedMilliseconds: 5,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    };
    const apiReport = {
      diagnostics: [
        makeDiagnostic({
          rule: "no-array-index-key",
          severity: "warning",
          filePath: "apps/api/src/Cart.tsx",
        }),
      ],
      score: apiScore,
      projectedScore: null,
      projectName: "api",
      rootDirectory: "/tmp/repo/apps/api",
      scannedFileCount: 6,
      elapsedMilliseconds: 5,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    };
    store.setSummary({
      projects: [webReport, apiReport],
      aggregateScore: webReport.score,
      projectedScore: null,
      combinedDiagnostics: [...webReport.diagnostics, ...apiReport.diagnostics],
      scannedFileCount: 10,
      elapsedMilliseconds: 12,
      projectName: "repo",
      rootDirectory: "/tmp/repo",
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, stdout, unmount } = render(
      <ScanApp store={store} canAddToCi onAddToCi={() => {}} />,
    );
    await flush();
    resizeTerminal(stdout, { rows: 30 });
    await flush();
    expect(lastFrame()).toContain(`${figures.pointer} Review 2 issues`);
    expect(lastFrame()).toContain("Add to GitHub Actions (Recommended)");
    expect(lastFrame()).toContain("58");
    stdin.write("\r");
    await flush();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("react-doctor/rules-of-hooks");
    expect(frame).toContain("react-doctor/no-array-index-key");
    expect(frame.indexOf("react-doctor/no-array-index-key")).toBeLessThan(
      frame.indexOf("react-doctor/rules-of-hooks"),
    );
    expect(frame).toContain("apps/api/src/Cart.tsx");
    expect(frame).toContain("2 projects");
    unmount();
  });

  it("moves the selection with j/k and quits on q", async () => {
    const store = createScanStore();
    const onQuit = vi.fn();
    store.setReport({
      diagnostics: [
        makeDiagnostic({ rule: "rules-of-hooks", severity: "error", category: "Correctness" }),
        makeDiagnostic({ rule: "no-array-index-key", filePath: "src/Cart.tsx", line: 9 }),
      ],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 2,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, stdout, unmount } = render(
      <ScanApp store={store} canAddToCi onAddToCi={() => {}} onQuit={onQuit} />,
    );
    await flush();
    resizeTerminal(stdout, { rows: 30 });
    await flush();

    expect(lastFrame()).toContain(`${figures.pointer} Review 2 issues`);
    stdin.write("\r");
    await flush();

    expect(lastFrame() ?? "").toContain("react-doctor/rules-of-hooks");
    expect(lastFrame() ?? "").toContain("Correctness · error");

    stdin.write("j");
    await flush();
    expect(lastFrame() ?? "").toContain("no-array-index-key");

    stdin.write("\u001B");
    await flush();
    const returnedLandingFrame = lastFrame() ?? "";
    expect(returnedLandingFrame).toContain(
      `${figures.pointer} Add to GitHub Actions (Recommended)`,
    );
    expect(returnedLandingFrame).toContain("› Review 2 issues");
    expect(returnedLandingFrame).not.toContain("Top 1 error to review first");

    stdin.write("k");
    await flush();
    stdin.write("\r");
    await flush();
    expect(lastFrame()).toContain("issue 2/2");
    expect(lastFrame()).toContain("State & Effects");
    expect(lastFrame()).toMatch(/› [⚠!] react-doctor\/no-array-index-key/);
    expect(lastFrame()).toContain("0 issues unread");

    stdin.write("q");
    await flush();
    expect(onQuit).toHaveBeenCalledOnce();
    unmount();
  });

  it("focuses agent handoff after review when CI setup is unavailable", async () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, unmount } = render(
      <ScanApp store={store} launchableAgents={["codex"]} onHandoff={() => {}} />,
    );
    await flush();

    stdin.write("\r");
    await flush();
    stdin.write("\u001B");
    await flush();

    expect(lastFrame()).toContain(`${figures.pointer} Hand off to an agent`);
    expect(lastFrame()).toContain("› Review 1 issue");
    unmount();
  });

  it("quits while the report reveal is still running", async () => {
    const store = createScanStore();
    const onQuit = vi.fn();
    store.setReport({
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { stdin, unmount } = render(<ScanApp store={store} onQuit={onQuit} />);
    stdin.write("q");
    await flush();

    expect(onQuit).toHaveBeenCalledOnce();
    unmount();
  });

  it("quits quietly with escape from the landing action menu", async () => {
    const store = createScanStore();
    const onQuit = vi.fn();
    store.setReport({
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { stdin, unmount } = render(<ScanApp store={store} onQuit={onQuit} />);
    await flush();
    stdin.write("\u001B");
    await flush();

    expect(onQuit).toHaveBeenCalledOnce();
    unmount();
  });

  it("copies the selected issue context without opening an action menu", async () => {
    const copyToClipboard = vi.spyOn(launchAgent, "copyToClipboard").mockResolvedValue(true);
    const store = createScanStore();
    store.setReport({
      diagnostics: [
        makeDiagnostic({ rule: "rules-of-hooks", severity: "error", category: "Correctness" }),
      ],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, stdout, unmount } = render(
      <ScanApp store={store} launchableAgents={["codex"]} />,
    );
    resizeTerminal(stdout, { rows: 40 });
    await flush();

    stdin.write("\r");
    await flush();

    expect(lastFrame()).toContain("enter copy context");
    expect(lastFrame()).toContain("Correctness · error");

    stdin.write("\r");
    await flush();
    expect(copyToClipboard).toHaveBeenCalledOnce();
    expect(copyToClipboard.mock.calls[0]?.[0]).toContain("react-doctor/rules-of-hooks");
    expect(lastFrame()).toContain("✓ Copied issue context");
    expect(lastFrame()).not.toContain("Codex");
    unmount();
  });

  it("confirms a copied prompt in the compact report", async () => {
    vi.spyOn(launchAgent, "copyToClipboard").mockResolvedValue(true);
    const store = createScanStore();
    store.setReport({
      diagnostics: [
        makeDiagnostic({ rule: "rules-of-hooks", severity: "error", category: "Correctness" }),
      ],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, stdout, unmount } = render(<ScanApp store={store} />);
    resizeTerminal(stdout, { rows: TUI_REPORT_COMPACT_MAX_ROWS });
    await flush();

    stdin.write("\r");
    await flush();
    stdin.write("\r");
    await flush();

    expect(lastFrame()).toContain("✓ Copied issue context");
    unmount();
  });

  it("shows a retry when copying issue context fails", async () => {
    vi.spyOn(launchAgent, "copyToClipboard").mockResolvedValue(false);
    const store = createScanStore();
    store.setReport({
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, stdout, unmount } = render(<ScanApp store={store} />);
    resizeTerminal(stdout, { rows: TUI_REPORT_COMPACT_MAX_ROWS });
    await flush();
    stdin.write("\r");
    await flush();
    stdin.write("\r");
    await flush();

    expect(lastFrame()).toContain("Copy failed · enter retry");
    unmount();
  });

  it("fills a wide terminal with the side-by-side issue browser", async () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [
        makeDiagnostic({ rule: "rules-of-hooks", severity: "error", category: "Correctness" }),
        makeDiagnostic({ rule: "no-array-index-key", severity: "warning", category: "Bugs" }),
      ],
      score: SCORE,
      projectedScore: 88,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 2,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, stdout, unmount } = render(<ScanApp store={store} />);
    const terminalRows = TUI_REPORT_COMPACT_MAX_ROWS * 2;
    await flush();
    resizeTerminal(stdout, {
      columns: TUI_DEFAULT_TERMINAL_COLUMNS * 2,
      rows: terminalRows,
    });
    await flush();

    const landingFrame = lastFrame() ?? "";
    const faceStart = landingFrame.split("\n").findIndex((line) => line.includes("┌─────┐"));
    expect(landingFrame.split("\n")[faceStart + 1]).toContain("│ • • │");
    expect(landingFrame.split("\n")[faceStart + 2]).toContain("│  ─  │");
    expect(landingFrame.split("\n")[faceStart + 3]).toContain("└─────┘");

    stdin.write("\r");
    await flush();
    const issueFrame = lastFrame() ?? "";
    expect(issueFrame.split("\n").length).toBe(terminalRows - TUI_REPORT_VIEWPORT_MARGIN_ROWS);
    expect(issueFrame).toContain("┌─────┐");
    expect(issueFrame).toContain("React Doctor (https://react.doctor)");
    expect(issueFrame).not.toContain("Potential score");
    expect(issueFrame).toContain("│");
    expect(issueFrame).toMatch(/react-doctor\/rules-of-hooks.*│/);
    unmount();
  });

  it("caps the issue list in a tall stacked layout", async () => {
    const store = createScanStore();
    const diagnostics = Array.from(
      { length: TUI_REPORT_STACKED_MAX_LIST_ROWS * 2 },
      (_, diagnosticIndex) =>
        makeDiagnostic({
          rule: `rule-${String(diagnosticIndex).padStart(2, "0")}`,
          severity: diagnosticIndex === 0 ? "error" : "warning",
          category: "Correctness",
        }),
    );
    store.setReport({
      diagnostics,
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: process.cwd(),
      scannedFileCount: diagnostics.length,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, stdout, unmount } = render(<ScanApp store={store} />);
    resizeTerminal(stdout, {
      columns: TUI_DEFAULT_TERMINAL_COLUMNS,
      rows: TUI_REPORT_COMPACT_MAX_ROWS * 2,
    });
    await flush();

    stdin.write("\r");
    await flush();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("React Doctor (https://react.doctor)");
    expect(frame).toContain("Your users briefly see stale state");
    expect(frame).toContain("react-doctor/rule-00");
    expect(frame).not.toContain(`react-doctor/rule-${TUI_REPORT_STACKED_MAX_LIST_ROWS}`);
    expect(frame.split("\n").length).toBeLessThan(TUI_REPORT_COMPACT_MAX_ROWS * 2);
    unmount();
  });

  it("keeps the compact viewport until stacked details fit beside a navigable list", async () => {
    const store = createScanStore();
    const diagnostics = Array.from({ length: 30 }, (_, diagnosticIndex) =>
      makeDiagnostic({
        rule: `rule-${String(diagnosticIndex).padStart(2, "0")}`,
        severity: diagnosticIndex === 0 ? "error" : "warning",
        category: "Correctness",
      }),
    );
    store.setReport({
      diagnostics,
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: process.cwd(),
      scannedFileCount: diagnostics.length,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, stdout, unmount } = render(<ScanApp store={store} />);
    resizeTerminal(stdout, { rows: TUI_REPORT_COMPACT_MAX_ROWS });
    await flush();

    expect(lastFrame()).toContain("┌─────┐");
    expect(lastFrame()).toContain(`${figures.pointer} Review 30 issues`);
    stdin.write("\r");
    await flush();

    expect((lastFrame() ?? "").split("\n").length).toBeLessThanOrEqual(TUI_REPORT_COMPACT_MAX_ROWS);
    expect(lastFrame()).toContain("React Doctor (https://react.doctor)");
    expect(lastFrame()).not.toContain("Your users briefly see stale state");
    expect(lastFrame()).toContain("30 findings");

    stdin.write("G");
    await flush();

    expect(lastFrame()).toContain("issue 30/30");
    expect(lastFrame()).toContain("react-doctor/rule-29");
    unmount();
  });

  it("keeps the selected finding visible when the terminal shrinks", async () => {
    const store = createScanStore();
    const diagnostics = Array.from({ length: 20 }, (_, diagnosticIndex) =>
      makeDiagnostic({
        rule: `resize-rule-${String(diagnosticIndex).padStart(2, "0")}`,
        title: `Resize finding ${diagnosticIndex}`,
        severity: diagnosticIndex === 0 ? "error" : "warning",
        category: "Correctness",
      }),
    );
    store.setReport({
      diagnostics,
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: process.cwd(),
      scannedFileCount: diagnostics.length,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, stdout, unmount } = render(<ScanApp store={store} />);
    resizeTerminal(stdout, { columns: 160, rows: 44 });
    await flush();
    stdin.write("\r");
    await flush();
    for (let diagnosticIndex = 0; diagnosticIndex < 12; diagnosticIndex += 1) {
      stdin.write("j");
      await flush();
    }
    resizeTerminal(stdout, { columns: 60, rows: 8 });
    await flush();

    expect(lastFrame()).toMatch(/› [⚠!] Resize finding 12/);
    expect(lastFrame()).toContain("issue 13/20");
    unmount();
  });

  it("fits the compact viewer inside a very narrow terminal", async () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: process.cwd(),
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, stdout, unmount } = render(<ScanApp store={store} />);
    resizeTerminal(stdout, { columns: 15, rows: 12 });
    await flush();
    stdin.write("\r");
    await flush();

    const lineWidths = (lastFrame() ?? "").split("\n").map((line) => [...line].length);
    expect(Math.max(...lineWidths)).toBeLessThanOrEqual(15);
    unmount();
  });

  it("shows only usable controls when a clean report has no actions", async () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [],
      score: { score: 100, label: "Perfect" },
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: process.cwd(),
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    await flush();

    expect(lastFrame()).toContain("✔ No issues found. Nice work.");
    expect(lastFrame()).toContain("q quit");
    expect(lastFrame()).not.toContain("↑/↓ move");
    expect(lastFrame()).not.toContain("enter select");
    unmount();
  });

  it("shows why a filtered report has no visible issues", async () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: process.cwd(),
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
      emptyStateMessage: "No issues found in category Security!",
    });

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    await flush();

    expect(lastFrame()).toContain("✔ No issues found in category Security!");
    expect(lastFrame()).not.toContain("Nice work");
    unmount();
  });

  it("justifies CI setup before confirming the workflow change", async () => {
    const store = createScanStore();
    const onAddToCi = vi.fn();
    store.setReport({
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, unmount } = render(
      <ScanApp store={store} canAddToCi onAddToCi={onAddToCi} />,
    );
    await flush();

    expect(lastFrame()).toContain(`${figures.pointer} Review 1 issue`);
    expect(lastFrame()).toContain("Add to GitHub Actions (Recommended)");
    expect(lastFrame()).toContain(
      `${figures.pointer} Review 1 issue\n\n› Add to GitHub Actions (Recommended)`,
    );
    stdin.write("j");
    await flush();
    expect(lastFrame()).toContain(`${figures.pointer} Add to GitHub Actions (Recommended)`);
    expect(lastFrame()).toContain("Used by teams at PayPal, Rippling, and Alibaba.");
    stdin.write("\r");
    await flush();

    expect(lastFrame()).toContain("Add React Doctor to GitHub Actions?");
    expect(lastFrame()).toContain(
      "Scan every pull request to prevent new React issues while you fix the backlog.",
    );
    expect(lastFrame()).toContain("Used by teams at PayPal, Rippling, and Alibaba.");
    expect(lastFrame()).toContain(GITHUB_ACTIONS_SETUP_URL);
    const ciSetupLines = (lastFrame() ?? "").split("\n");
    const trustLineIndex = ciSetupLines.findIndex((line) =>
      line.includes("Used by teams at PayPal, Rippling, and Alibaba."),
    );
    expect(ciSetupLines[trustLineIndex + 1]).toContain(GITHUB_ACTIONS_SETUP_URL);
    expect(lastFrame()).not.toContain("`doctor` package script");
    expect(lastFrame()).toContain(`${figures.pointer} Yes, add the workflow`);
    expect(lastFrame()).toContain("Open the GitHub Actions guide");

    stdin.write("\u001B");
    await flush();
    expect(onAddToCi).not.toHaveBeenCalled();
    expect(lastFrame()).toContain(`${figures.pointer} Add to GitHub Actions (Recommended)`);

    stdin.write("\r");
    await flush();
    stdin.write("\r");
    await flush();
    expect(onAddToCi).toHaveBeenCalledOnce();
    unmount();
  });

  it("opens the CI documentation from the setup confirmation", async () => {
    const openUrl = vi.spyOn(openUrlModule, "openUrl").mockResolvedValue(true);
    const store = createScanStore();
    store.setReport({
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, unmount } = render(
      <ScanApp store={store} canAddToCi onAddToCi={() => {}} />,
    );
    await flush();

    stdin.write("j");
    await flush();
    stdin.write("\r");
    await flush();
    stdin.write("j");
    await flush();
    stdin.write("\r");
    await flush();
    expect(openUrl).toHaveBeenLastCalledWith(GITHUB_ACTIONS_SETUP_URL);
    expect(lastFrame()).toContain("Opened the GitHub Actions guide in your browser");
    unmount();
  });

  it("shows the CI guide URL when a browser cannot be opened", async () => {
    vi.spyOn(openUrlModule, "openUrl").mockResolvedValue(false);
    const store = createScanStore();
    store.setReport({
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, unmount } = render(
      <ScanApp store={store} canAddToCi onAddToCi={() => {}} />,
    );
    await flush();
    stdin.write("j");
    await flush();
    stdin.write("\r");
    await flush();
    stdin.write("j");
    await flush();
    stdin.write("\r");
    await flush();

    expect(lastFrame()).toContain(`Couldn't open a browser. Visit ${GITHUB_ACTIONS_SETUP_URL}`);
    unmount();
  });

  it("recommends CI before handoff and continues to the agent picker when dismissed", async () => {
    const onAddToCi = vi.fn();
    const onHandoff = vi.fn();
    const store = createScanStore();
    store.setReport({
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, unmount } = render(
      <ScanApp
        store={store}
        launchableAgents={["codex", "cursor"]}
        onHandoff={onHandoff}
        canAddToCi
        onAddToCi={onAddToCi}
      />,
    );
    await flush();

    stdin.write("j");
    await flush();
    stdin.write("j");
    await flush();
    expect(lastFrame()).toContain(`${figures.pointer} Hand off to an agent`);
    stdin.write("\r");
    await flush();

    expect(lastFrame()).toContain("  Add React Doctor to GitHub Actions first");
    expect(lastFrame()).toContain(
      "Scan every pull request to prevent new React issues while you fix the backlog.",
    );
    expect(lastFrame()).toContain("Used by teams at PayPal, Rippling, and Alibaba.");
    expect(lastFrame()).toContain(`${figures.pointer} Add to GitHub Actions first (Recommended)`);
    expect(lastFrame()).toContain("Continue without GitHub Actions");

    stdin.write("\u001B");
    await flush();
    expect(onAddToCi).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("  Choose an agent");
    expect(lastFrame()).toContain(`${figures.pointer} Codex`);
    expect(lastFrame()).toContain("Cursor");

    stdin.write("\r");
    await flush();
    expect(onHandoff).toHaveBeenCalledOnce();
    const request = onHandoff.mock.calls[0]?.[0];
    expect(request?.agentId).toBe("codex");
    expect(request?.prompt).not.toContain("First, configure React Doctor in GitHub Actions");
    unmount();
  });

  it("queues CI setup before launching the selected agent", async () => {
    const onAddToCi = vi.fn();
    const onHandoff = vi.fn();
    const store = createScanStore();
    store.setReport({
      diagnostics: [makeDiagnostic({ rule: "rules-of-hooks", severity: "error" })],
      score: SCORE,
      projectedScore: null,
      projectName: "demo-app",
      rootDirectory: "/tmp/demo-app",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    const { lastFrame, stdin, unmount } = render(
      <ScanApp
        store={store}
        launchableAgents={["codex"]}
        onHandoff={onHandoff}
        canAddToCi
        onAddToCi={onAddToCi}
      />,
    );
    await flush();

    stdin.write("j");
    await flush();
    stdin.write("j");
    await flush();
    stdin.write("\r");
    await flush();
    stdin.write("\r");
    await flush();
    expect(onAddToCi).toHaveBeenCalledOnce();
    expect(lastFrame()).toContain(`${figures.pointer} Codex`);

    stdin.write("\u001B");
    await flush();
    expect(lastFrame()).not.toContain("Add to GitHub Actions (Recommended)");
    expect(lastFrame()).toContain(`${figures.pointer} Hand off to an agent`);

    stdin.write("\r");
    await flush();
    expect(lastFrame()).toContain(`${figures.pointer} Codex`);
    expect(lastFrame()).not.toContain("Add React Doctor to GitHub Actions first");

    stdin.write("\r");
    await flush();
    expect(onHandoff).toHaveBeenCalledOnce();
    expect(onHandoff.mock.calls[0]?.[0].prompt).not.toContain(
      "First, configure React Doctor in GitHub Actions",
    );
    expect(onAddToCi).toHaveBeenCalledOnce();
    unmount();
  });
});
