import { describe, expect, it } from "vite-plus/test";
import { mapWithConcurrency } from "../src/utils/map-with-concurrency.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
  it("returns results in input order regardless of completion order", async () => {
    const results = await mapWithConcurrency([40, 10, 30, 5], 4, async (ms, index) => {
      await sleep(ms);
      return `result-${index}`;
    });
    expect(results).toEqual(["result-0", "result-1", "result-2", "result-3"]);
  });

  it("runs at most `concurrency` tasks at once but more than one", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    await mapWithConcurrency([...Array(12).keys()], 4, async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await sleep(10);
      inFlight -= 1;
    });
    expect(peakInFlight).toBe(4);
  });

  it("runs strictly serially when concurrency is 1", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const completionOrder: number[] = [];
    await mapWithConcurrency([1, 2, 3, 4], 1, async (item) => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await sleep(3);
      completionOrder.push(item);
      inFlight -= 1;
    });
    expect(peakInFlight).toBe(1);
    expect(completionOrder).toEqual([1, 2, 3, 4]);
  });

  it("returns an empty array for empty input without invoking the task", async () => {
    let invocationCount = 0;
    const results = await mapWithConcurrency([], 4, async () => {
      invocationCount += 1;
      return 1;
    });
    expect(results).toEqual([]);
    expect(invocationCount).toBe(0);
  });

  it("never starts more tasks than there are items", async () => {
    let peakInFlight = 0;
    let inFlight = 0;
    await mapWithConcurrency([1, 2], 8, async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await sleep(5);
      inFlight -= 1;
    });
    expect(peakInFlight).toBe(2);
  });

  it("stops scheduling new tasks after the first rejection and rejects with it", async () => {
    const started: number[] = [];
    let caught: unknown;
    // The two workers start items 0 and 1. Item 1 rejects quickly while item 0
    // is still held in its long sleep, so the rejection is recorded before any
    // worker frees up — guaranteeing items 2..5 are never pulled.
    await mapWithConcurrency([0, 1, 2, 3, 4, 5], 2, async (item) => {
      started.push(item);
      if (item === 1) {
        await sleep(5);
        throw new Error(`boom-${item}`);
      }
      await sleep(200);
      return item;
    }).catch((error: unknown) => {
      caught = error;
    });

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("boom-1");
    expect([...started].sort((a, b) => a - b)).toEqual([0, 1]);
  });

  it("rejects with the first error when several tasks fail", async () => {
    let caught: unknown;
    await mapWithConcurrency([0, 1], 2, async (item) => {
      // item 0 fails first (shorter delay), so its error is the one surfaced.
      await sleep(item === 0 ? 5 : 30);
      throw new Error(`fail-${item}`);
    }).catch((error: unknown) => {
      caught = error;
    });
    expect((caught as Error).message).toBe("fail-0");
  });
});
