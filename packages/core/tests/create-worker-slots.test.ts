import { describe, expect, it } from "vite-plus/test";
import { createWorkerSlots } from "../src/utils/create-worker-slots.js";
import { createDeferred, type Deferred } from "../src/utils/create-deferred.js";
import { yieldToEventLoop } from "../src/utils/yield-to-event-loop.js";

const createTestWorkerSlots = (slotCount: number) =>
  createWorkerSlots({
    slotCount,
    createAbortError: () => new Error("aborted"),
  });

describe("createWorkerSlots", () => {
  it("enforces the peak slot count and admits queued tasks in FIFO order", async () => {
    const workerSlots = createTestWorkerSlots(2);
    const firstRelease = createDeferred<void>();
    const secondRelease = createDeferred<void>();
    const thirdRelease = createDeferred<void>();
    const fourthRelease = createDeferred<void>();
    const startedTasks: string[] = [];
    let runningTaskCount = 0;
    let peakRunningTaskCount = 0;

    const runTask = (name: string, release: Deferred<void>): Promise<string> =>
      workerSlots.run(async () => {
        startedTasks.push(name);
        runningTaskCount += 1;
        peakRunningTaskCount = Math.max(peakRunningTaskCount, runningTaskCount);
        await release.promise;
        runningTaskCount -= 1;
        return name;
      });

    const results = Promise.all([
      runTask("first", firstRelease),
      runTask("second", secondRelease),
      runTask("third", thirdRelease),
      runTask("fourth", fourthRelease),
    ]);
    await yieldToEventLoop();
    expect(startedTasks).toEqual(["first", "second"]);

    secondRelease.resolve();
    await yieldToEventLoop();
    expect(startedTasks).toEqual(["first", "second", "third"]);

    firstRelease.resolve();
    await yieldToEventLoop();
    expect(startedTasks).toEqual(["first", "second", "third", "fourth"]);

    thirdRelease.resolve();
    fourthRelease.resolve();
    expect(await results).toEqual(["first", "second", "third", "fourth"]);
    expect(peakRunningTaskCount).toBe(2);
  });

  it("releases slots after rejection", async () => {
    const workerSlots = createTestWorkerSlots(1);
    await expect(
      workerSlots.run(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(workerSlots.run(async () => "after")).resolves.toBe("after");
  });

  it("removes an aborted waiter without running it or leaking a slot", async () => {
    const workerSlots = createTestWorkerSlots(1);
    const heldRelease = createDeferred<void>();
    const heldTask = workerSlots.run(() => heldRelease.promise);
    await yieldToEventLoop();

    const abortController = new AbortController();
    let didRunAbortedTask = false;
    const abortedTask = workerSlots.run(async () => {
      didRunAbortedTask = true;
    }, abortController.signal);
    abortController.abort();

    await expect(abortedTask).rejects.toThrow("aborted");
    expect(didRunAbortedTask).toBe(false);
    heldRelease.resolve();
    await heldTask;
    await expect(workerSlots.run(async () => "after")).resolves.toBe("after");
  });
});
