import { render } from "ink-testing-library";
import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic, ScoreResult } from "@react-doctor/core";
import { ScanApp } from "../../src/cli/ink/scan-app.js";
import { createScanStore } from "../../src/cli/ink/scan-store.js";

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

// ink-testing-library needs a tick for effects (useInput wiring) to flush.
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

// ink-testing-library hardcodes 100 columns (< the split threshold), so the
// report renders stacked by default. Widen the fake stdout and fire a resize so
// the report switches to the side-by-side layout for that test.
const widenTerminal = (stdout: { emit: (event: string) => void }): void => {
  Object.defineProperty(stdout, "columns", { get: () => 140, configurable: true });
  Object.defineProperty(stdout, "rows", { get: () => 40, configurable: true });
  stdout.emit("resize");
};

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

  it("renders the score header and the full sorted rule list once settled", () => {
    const store = createScanStore();
    // All in one category so the grouped list shows a single "Correctness"
    // header with both rules under it (fits the small test viewport).
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

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("72");
    expect(frame).toContain("demo-app");
    // No `title` on the test diagnostics → the row falls back to `plugin/rule`.
    // The detail headline is the title alone; category + severity ride a dim tag.
    expect(frame).toContain("react-doctor/rules-of-hooks");
    expect(frame).toContain("Correctness · error");
    // The second rule groups its two sites into one row with a count badge.
    expect(frame).toContain("×2");
    unmount();
  });

  it("shows the score projection and per-category breakdown", () => {
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

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("You could improve");
    expect(frame).toContain("+16%");
    expect(frame).toContain("Correctness");
    expect(frame).toContain("Bugs");
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

  it("renders a flat monorepo summary: aggregate score, combined list, folder-qualified paths", () => {
    const store = createScanStore();
    // Combined diagnostics carry folder-qualified paths (rewritten relative to
    // the monorepo root in `runScanApp`) so the flat list shows each finding's
    // project without a per-folder drill-in.
    const webReport = {
      diagnostics: [
        makeDiagnostic({
          rule: "rules-of-hooks",
          severity: "error",
          filePath: "apps/web/src/Profile.tsx",
        }),
      ],
      score: { score: 58, label: "Needs work" },
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
      score: { score: 91, label: "Great" },
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

    const { lastFrame, unmount } = render(<ScanApp store={store} />);
    const frame = lastFrame() ?? "";
    // Aggregate score is the worst project's (58, not 91).
    expect(frame).toContain("58");
    // Both projects' findings appear in one flat list (by rule title).
    expect(frame).toContain("react-doctor/rules-of-hooks");
    expect(frame).toContain("react-doctor/no-array-index-key");
    // The selected row's full, folder-qualified path shows in the detail pane.
    expect(frame).toContain("apps/web/src/Profile.tsx");
    // The project count rides the status bar instead of a navigable list.
    expect(frame).toContain("2 projects");
    unmount();
  });

  it("moves the selection with j/k and quits on q", async () => {
    const store = createScanStore();
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

    const { lastFrame, stdin, unmount } = render(<ScanApp store={store} />);
    await flush();

    // First row selected by default → detail pane shows the first rule's title
    // with a dim `category · severity` tag beneath it.
    expect(lastFrame() ?? "").toContain("react-doctor/rules-of-hooks");
    expect(lastFrame() ?? "").toContain("Correctness · error");

    stdin.write("j");
    await flush();
    // After moving down, the detail pane reflects the second rule.
    expect(lastFrame() ?? "").toContain("no-array-index-key");

    // `q` is handled without throwing (exit is wired through useApp()).
    stdin.write("q");
    await flush();
    unmount();
  });

  it("uses the side-by-side layout on a wide terminal", async () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [
        makeDiagnostic({ rule: "rules-of-hooks", severity: "error", category: "Correctness" }),
        makeDiagnostic({ rule: "no-array-index-key", severity: "warning", category: "Bugs" }),
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

    const { lastFrame, stdout, unmount } = render(<ScanApp store={store} />);
    widenTerminal(stdout);
    await flush();

    const frame = lastFrame() ?? "";
    // The split layout draws a vertical divider between the list and the detail,
    // so a row's title and its detail headline share a line.
    expect(frame).toContain("│");
    expect(frame).toMatch(/react-doctor\/rules-of-hooks.*│/);
    unmount();
  });
});
