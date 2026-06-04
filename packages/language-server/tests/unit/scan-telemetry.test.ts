import { describe, expect, it } from "vite-plus/test";
import type { Diagnostic as CoreDiagnostic } from "@react-doctor/core";
import { createScanTelemetry } from "../../src/runtime/scan-telemetry.js";
import type { ScanOutcome, WorkspaceScanTelemetry } from "../../src/types.js";

const diagnostic = (severity: "error" | "warning", category: string): CoreDiagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-doctor",
  rule: "some-rule",
  severity,
  message: "msg",
  help: "help",
  line: 1,
  column: 1,
  category,
});

const outcome = (
  byFile: Record<string, CoreDiagnostic[]>,
  overrides: Partial<ScanOutcome> = {},
): ScanOutcome => ({
  request: {
    id: 1,
    priority: "background",
    projectDirectory: "/repo",
    files: [],
    runDeadCode: false,
    useOverlay: false,
    reason: "test",
  },
  ok: true,
  skipped: false,
  byFile: new Map(Object.entries(byFile)),
  coversProject: true,
  requestedPaths: [],
  project: null,
  didLintFail: false,
  lintFailureReason: null,
  error: null,
  ...overrides,
});

// A controllable clock so duration assertions are deterministic.
const clock = (...times: number[]): (() => number) => {
  let index = 0;
  return () => times[Math.min(index++, times.length - 1)] ?? 0;
};

describe("createScanTelemetry", () => {
  it("aggregates background outcomes into one wide event on finish", () => {
    const events: WorkspaceScanTelemetry[] = [];
    // `now()` is read once at begin (start) and once at finish (duration).
    const scanTelemetry = createScanTelemetry(
      { recordSessionStart: () => {}, recordWorkspaceScan: (scan) => events.push(scan) },
      clock(1000, 3500),
    );

    scanTelemetry.begin("initial", 2);
    scanTelemetry.accumulate(
      outcome({
        "/repo/a.tsx": [diagnostic("error", "Performance"), diagnostic("warning", "Performance")],
      }),
    );
    scanTelemetry.accumulate(outcome({ "/repo/b.tsx": [diagnostic("warning", "Design")] }));
    scanTelemetry.finish();

    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.trigger).toBe("initial");
    expect(event.projectCount).toBe(2);
    expect(event.chunkCount).toBe(2);
    expect(event.filesWithDiagnostics).toBe(2);
    expect(event.totalDiagnostics).toBe(3);
    expect(event.errorCount).toBe(1);
    expect(event.warningCount).toBe(2);
    expect(event.diagnosticsByCategory).toEqual({ Performance: 2, Design: 1 });
    expect(event.durationMs).toBe(2500);
    expect(event.lintDegraded).toBe(false);
  });

  it("records lint degradation and partial-lint chunks", () => {
    const events: WorkspaceScanTelemetry[] = [];
    const scanTelemetry = createScanTelemetry({
      recordSessionStart: () => {},
      recordWorkspaceScan: (scan) => events.push(scan),
    });

    scanTelemetry.begin("config-change", 1);
    scanTelemetry.accumulate(outcome({}, { didLintFail: true }));
    scanTelemetry.accumulate(outcome({}, { lintIncomplete: true }));
    scanTelemetry.finish();

    expect(events[0]?.lintDegraded).toBe(true);
    expect(events[0]?.lintIncompleteChunks).toBe(1);
    expect(events[0]?.chunkCount).toBe(2);
  });

  it("skips a burst that scanned nothing", () => {
    const events: WorkspaceScanTelemetry[] = [];
    const scanTelemetry = createScanTelemetry({
      recordSessionStart: () => {},
      recordWorkspaceScan: (scan) => events.push(scan),
    });

    scanTelemetry.begin("manual", 1);
    scanTelemetry.finish();

    expect(events).toHaveLength(0);
  });

  it("ignores accumulate / finish with no active burst", () => {
    const events: WorkspaceScanTelemetry[] = [];
    const scanTelemetry = createScanTelemetry({
      recordSessionStart: () => {},
      recordWorkspaceScan: (scan) => events.push(scan),
    });

    scanTelemetry.accumulate(outcome({ "/repo/a.tsx": [diagnostic("error", "Bugs")] }));
    scanTelemetry.finish();

    expect(events).toHaveLength(0);
  });

  it("discards a superseded partial burst when a new one begins", () => {
    const events: WorkspaceScanTelemetry[] = [];
    const scanTelemetry = createScanTelemetry({
      recordSessionStart: () => {},
      recordWorkspaceScan: (scan) => events.push(scan),
    });

    scanTelemetry.begin("initial", 1);
    scanTelemetry.accumulate(outcome({ "/repo/a.tsx": [diagnostic("error", "Bugs")] }));
    // A config change restarts the scan before the first burst settled.
    scanTelemetry.begin("config-change", 1);
    scanTelemetry.accumulate(outcome({ "/repo/b.tsx": [diagnostic("warning", "Design")] }));
    scanTelemetry.finish();

    expect(events).toHaveLength(1);
    expect(events[0]?.trigger).toBe("config-change");
    expect(events[0]?.totalDiagnostics).toBe(1);
    expect(events[0]?.diagnosticsByCategory).toEqual({ Design: 1 });
  });
});
