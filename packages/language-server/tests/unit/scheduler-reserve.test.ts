import { describe, expect, it } from "vite-plus/test";
import { createScheduler } from "../../src/runtime/scheduler.js";
import { chunk } from "../../src/utils/chunk.js";
import type { ScanOutcome, ScanRequest, ScanRequestInput } from "../../src/types.js";

const delay = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

describe("chunk", () => {
  it("splits into consecutive batches of the given size", () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10],
    ]);
  });

  it("returns [] for empty input and treats size < 1 as 1", () => {
    expect(chunk([], 5)).toEqual([]);
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
});

interface Gate {
  readonly promise: Promise<ScanOutcome>;
  readonly resolve: () => void;
}

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

describe("scheduler reservedInteractiveSlots", () => {
  it("caps background parallelism but lets interactive use a reserved slot", async () => {
    const gates: Gate[] = [];
    const started: ScanRequest[] = [];

    const scheduler = createScheduler({
      performScan: (request) => {
        started.push(request);
        let resolveOutcome!: () => void;
        const promise = new Promise<ScanOutcome>((resolve) => {
          resolveOutcome = () => resolve(makeOutcome(request));
        });
        gates.push({ promise, resolve: resolveOutcome });
        return promise;
      },
      onResult: () => {},
      debounceMs: 5,
      concurrency: 2,
      reservedInteractiveSlots: 1,
    });

    const background = (file: string): ScanRequestInput => ({
      priority: "background",
      projectDirectory: "/p",
      files: [file],
      runDeadCode: false,
      useOverlay: false,
      reason: "bg",
    });

    scheduler.enqueue(background("a"));
    scheduler.enqueue(background("b"));
    await delay(25);
    // maxBackground = concurrency(2) - reserved(1) = 1, so only one runs.
    expect(started.length).toBe(1);
    expect(started[0].priority).toBe("background");

    scheduler.enqueue({
      priority: "interactive",
      projectDirectory: "/p",
      files: ["c"],
      runDeadCode: false,
      useOverlay: true,
      reason: "edit",
    });
    await delay(25);
    // Interactive runs immediately in the reserved slot, alongside the
    // one background scan still in flight.
    expect(started.length).toBe(2);
    expect(started[1].priority).toBe("interactive");

    gates[0].resolve();
    await delay(25);
    // First background finished → second background now runs.
    expect(started.length).toBe(3);
    expect(started[2].priority).toBe("background");

    for (const gate of gates) gate.resolve();
    scheduler.dispose();
  });
});
