import { describe, expect, it } from "vite-plus/test";
import { withDeadCodeWorkerSlot } from "../src/dead-code/dead-code-worker-slots.js";
import { resolveDeadCodeConcurrency } from "../src/utils/resolve-dead-code-concurrency.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("withDeadCodeWorkerSlot", () => {
  it("never runs more tasks at once than the resolved concurrency", async () => {
    const cap = resolveDeadCodeConcurrency();
    let inFlight = 0;
    let peakInFlight = 0;
    const task = async (): Promise<string> => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await sleep(5);
      inFlight -= 1;
      return "ok";
    };
    // Twice the cap → the extra callers must queue, so the peak lands exactly
    // at the cap (not higher), proving the gate, and every caller still runs.
    const results = await Promise.all(
      Array.from({ length: cap * 2 }, () => withDeadCodeWorkerSlot(task)),
    );
    expect(results).toHaveLength(cap * 2);
    expect(results.every((value) => value === "ok")).toBe(true);
    expect(peakInFlight).toBe(cap);
  });

  it("releases the slot when a task rejects, so later tasks still run", async () => {
    await expect(
      withDeadCodeWorkerSlot(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // A leaked slot would (on a cap-1 runner) wedge this forever.
    expect(await withDeadCodeWorkerSlot(async () => "after")).toBe("after");
  });
});
