import { describe, expect, it } from "vite-plus/test";
import { resolveWorkerTelemetry } from "../src/cli/utils/resolve-worker-telemetry.js";

describe("resolveWorkerTelemetry", () => {
  it("reports the resolved auto count and parallel=true when no count was pinned", () => {
    // The headline case: auto path, caller pinned nothing — telemetry must still
    // see the real worker count and read parallel, not fall back to false.
    expect(resolveWorkerTelemetry(8, undefined)).toEqual({ workerCount: 8, parallel: true });
  });

  it("reports parallel=false for a single-worker (serial) run", () => {
    expect(resolveWorkerTelemetry(1, undefined)).toEqual({ workerCount: 1, parallel: false });
    // A pinned serial run (`inspect({ concurrency: 1 })`) is NOT parallel, even
    // though a count was pinned — the old `concurrency !== undefined` proxy got
    // this wrong.
    expect(resolveWorkerTelemetry(1, 1)).toEqual({ workerCount: 1, parallel: false });
  });

  it("prefers the resolved count over the pin", () => {
    expect(resolveWorkerTelemetry(12, 4)).toEqual({ workerCount: 12, parallel: true });
  });

  it("falls back to the pin when no resolved count is available (stale cache / failure path)", () => {
    expect(resolveWorkerTelemetry(undefined, 4)).toEqual({ workerCount: 4, parallel: true });
    expect(resolveWorkerTelemetry(undefined, 1)).toEqual({ workerCount: 1, parallel: false });
  });

  it("reports an undefined count and parallel=false when neither source knows it", () => {
    expect(resolveWorkerTelemetry(undefined, undefined)).toEqual({
      workerCount: undefined,
      parallel: false,
    });
  });
});
