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

  it("rejects an already-aborted caller without running its task", async () => {
    let taskRan = false;
    await expect(
      withDeadCodeWorkerSlot(async () => {
        taskRan = true;
        return "ran";
      }, AbortSignal.abort()),
    ).rejects.toThrow(/aborted/i);
    expect(taskRan).toBe(false);
  });

  it("rejects a queued caller when its abort fires during the wait, without leaking the slot", async () => {
    const cap = resolveDeadCodeConcurrency();
    let releaseHeld!: () => void;
    const heldGate = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    // Occupy every slot so the next caller has to queue.
    const held = Array.from({ length: cap }, () => withDeadCodeWorkerSlot(() => heldGate));
    const controller = new AbortController();
    let queuedTaskRan = false;
    const queued = withDeadCodeWorkerSlot(async () => {
      queuedTaskRan = true;
      return "ran";
    }, controller.signal);
    await sleep(5);
    controller.abort();
    await expect(queued).rejects.toThrow(/aborted/i);
    expect(queuedTaskRan).toBe(false);
    // Drain the held slots; if the aborted waiter had leaked a slot the
    // semaphore would now be permanently down one, wedging the call below.
    releaseHeld();
    await Promise.all(held);
    expect(await withDeadCodeWorkerSlot(async () => "after")).toBe("after");
  });
});
