import { describe, expect, it } from "vite-plus/test";

import { createConcurrencyLimit } from "../src/utils/create-concurrency-limit.js";

describe("createConcurrencyLimit", () => {
  it("runs queued operations in FIFO order without exceeding the limit", async () => {
    const limit = createConcurrencyLimit(2);
    const startedOperations: number[] = [];
    let activeOperationCount = 0;
    let maximumActiveOperationCount = 0;

    const results = [1, 2, 3, 4].map((operationId) =>
      limit(async () => {
        startedOperations.push(operationId);
        activeOperationCount += 1;
        maximumActiveOperationCount = Math.max(maximumActiveOperationCount, activeOperationCount);
        await Promise.resolve();
        activeOperationCount -= 1;
        return operationId;
      }),
    );

    await expect(Promise.all(results)).resolves.toEqual([1, 2, 3, 4]);
    expect(startedOperations).toEqual([1, 2, 3, 4]);
    expect(maximumActiveOperationCount).toBe(2);
  });

  it("releases a slot when an operation rejects", async () => {
    const limit = createConcurrencyLimit(1);
    const rejectedOperation = limit(() => Promise.reject(new Error("failed")));
    const nextOperation = limit(() => "completed");

    await expect(rejectedOperation).rejects.toThrow("failed");
    await expect(nextOperation).resolves.toBe("completed");
  });

  it("rejects invalid concurrency", () => {
    expect(() => createConcurrencyLimit(0)).toThrow("positive integer");
  });
});
