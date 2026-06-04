import { describe, expect, it } from "vite-plus/test";
import { createScheduler } from "../../src/runtime/scheduler.js";
import type { ScanOutcome, ScanRequest, ScanRequestInput } from "../../src/types.js";

const delay = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Polls until `predicate` holds (or times out) — avoids fixed-delay flakes on slow CI. */
const waitFor = async (predicate: () => boolean, timeoutMs = 2000): Promise<void> => {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await delay(5);
  }
};

const makeOutcome = (request: ScanRequest): ScanOutcome => ({
  request,
  ok: true,
  skipped: false,
  byFile: new Map(),
  coversProject: request.files.length === 0,
  requestedPaths: request.files,
  project: null,
  didLintFail: false,
  lintFailureReason: null,
  error: null,
});

const interactiveInput = (overrides: Partial<ScanRequestInput> = {}): ScanRequestInput => ({
  priority: "interactive",
  projectDirectory: "/repo",
  files: ["/repo/src/App.tsx"],
  runDeadCode: false,
  useOverlay: true,
  reason: "edit",
  ...overrides,
});

describe("createScheduler", () => {
  it("debounces and coalesces rapid interactive enqueues into a single scan", async () => {
    let scanCount = 0;
    const results: ScanOutcome[] = [];
    const scheduler = createScheduler({
      performScan: async (request) => {
        scanCount += 1;
        return makeOutcome(request);
      },
      onResult: (outcome) => results.push(outcome),
      debounceMs: 15,
    });

    scheduler.enqueue(interactiveInput());
    scheduler.enqueue(interactiveInput());
    scheduler.enqueue(interactiveInput());

    await delay(70);

    expect(scanCount).toBe(1);
    expect(results).toHaveLength(1);
    scheduler.dispose();
  });

  it("drops a superseded in-flight scan and only reports the newest", async () => {
    const scannedReasons: string[] = [];
    const reportedReasons: string[] = [];
    const scheduler = createScheduler({
      performScan: async (request) => {
        scannedReasons.push(request.reason);
        await delay(50);
        return makeOutcome(request);
      },
      onResult: (outcome) => reportedReasons.push(outcome.request.reason),
      debounceMs: 10,
      concurrency: 2,
    });

    scheduler.enqueue(interactiveInput({ reason: "scan-a" }));
    await delay(25);
    scheduler.enqueue(interactiveInput({ reason: "scan-b" }));

    await delay(120);

    expect(scannedReasons).toContain("scan-a");
    expect(reportedReasons).toEqual(["scan-b"]);
    scheduler.dispose();
  });

  it("cancelProject prevents a pending scan from running", async () => {
    let scanCount = 0;
    let resultCount = 0;
    const scheduler = createScheduler({
      performScan: async (request) => {
        scanCount += 1;
        return makeOutcome(request);
      },
      onResult: () => {
        resultCount += 1;
      },
      debounceMs: 30,
    });

    scheduler.enqueue(interactiveInput());
    scheduler.cancelProject("/repo");

    await delay(70);

    expect(scanCount).toBe(0);
    expect(resultCount).toBe(0);
    scheduler.dispose();
  });

  it("dequeues interactive scans ahead of save and background scans", async () => {
    const runOrder: string[] = [];
    const scheduler = createScheduler({
      performScan: async (request) => {
        runOrder.push(request.reason);
        await delay(25);
        return makeOutcome(request);
      },
      onResult: () => {},
      debounceMs: 5,
      concurrency: 1,
    });

    scheduler.enqueue(
      interactiveInput({ priority: "save", files: ["/repo/blocker.ts"], reason: "blocker" }),
    );
    scheduler.enqueue(
      interactiveInput({ priority: "background", files: ["/repo/bg.ts"], reason: "bg" }),
    );
    scheduler.enqueue(
      interactiveInput({ priority: "save", files: ["/repo/save.ts"], reason: "save2" }),
    );
    scheduler.enqueue(
      interactiveInput({ priority: "interactive", files: ["/repo/int.ts"], reason: "int" }),
    );

    // Wait until all four scans have started (deterministic) rather than a
    // fixed delay, which raced the trailing background scan on slow CI.
    await waitFor(() => runOrder.length === 4);

    expect(runOrder).toEqual(["blocker", "int", "save2", "bg"]);
    scheduler.dispose();
  });
});
