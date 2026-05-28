import { describe, expect, it } from "vite-plus/test";
import { mapWithConcurrency } from "@react-doctor/core";

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
};

describe("mapWithConcurrency", () => {
  it("returns an empty array for empty input", async () => {
    const results = await mapWithConcurrency([], 4, async (item) => item);
    expect(results).toEqual([]);
  });

  it("preserves result order even when items resolve out of order", async () => {
    const results = await mapWithConcurrency([10, 30, 20], 3, async (delayMs, index) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return `${index}:${delayMs}`;
    });
    expect(results).toEqual(["0:10", "1:30", "2:20"]);
  });

  it("never exceeds the concurrency limit of in-flight calls", async () => {
    const gates = Array.from({ length: 6 }, () => deferred<void>());
    let activeCount = 0;
    let peakActiveCount = 0;

    const pending = mapWithConcurrency(gates, 2, async (gate) => {
      activeCount += 1;
      peakActiveCount = Math.max(peakActiveCount, activeCount);
      await gate.promise;
      activeCount -= 1;
      return null;
    });

    // Release gates one at a time; the pool must keep at most 2 alive.
    for (const gate of gates) {
      await Promise.resolve();
      gate.resolve();
    }
    await pending;
    expect(peakActiveCount).toBe(2);
  });

  it("treats a limit larger than the item count as 'all at once'", async () => {
    let activeCount = 0;
    let peakActiveCount = 0;
    const gates = Array.from({ length: 3 }, () => deferred<void>());

    const pending = mapWithConcurrency(gates, 100, async (gate) => {
      activeCount += 1;
      peakActiveCount = Math.max(peakActiveCount, activeCount);
      await gate.promise;
      activeCount -= 1;
      return null;
    });
    await Promise.resolve();
    for (const gate of gates) gate.resolve();
    await pending;
    expect(peakActiveCount).toBe(3);
  });

  it("clamps a sub-1 limit to a single worker", async () => {
    let activeCount = 0;
    let peakActiveCount = 0;
    const gates = Array.from({ length: 3 }, () => deferred<void>());

    const pending = mapWithConcurrency(gates, 0, async (gate) => {
      activeCount += 1;
      peakActiveCount = Math.max(peakActiveCount, activeCount);
      await gate.promise;
      activeCount -= 1;
      return null;
    });
    await Promise.resolve();
    for (const gate of gates) gate.resolve();
    await pending;
    expect(peakActiveCount).toBe(1);
  });

  it("propagates a rejection from any worker", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (value) => {
        if (value === 2) throw new Error("boom");
        return value;
      }),
    ).rejects.toThrow("boom");
  });
});
