import { describe, expect, it } from "vite-plus/test";
import { withProjectAnalysisWorkerSlot } from "../src/project-analysis/project-analysis-worker-slots.js";
import { createDeferred } from "../src/utils/create-deferred.js";
import { resolveProjectAnalysisConcurrency } from "../src/utils/resolve-project-analysis-concurrency.js";
import { yieldToEventLoop } from "../src/utils/yield-to-event-loop.js";

describe("withProjectAnalysisWorkerSlot", () => {
  it("bounds concurrent project analysis workers", async () => {
    const concurrency = resolveProjectAnalysisConcurrency();
    const releases = Array.from({ length: concurrency + 1 }, () => createDeferred<void>());
    let runningTaskCount = 0;
    let peakRunningTaskCount = 0;
    const tasks = releases.map((release) =>
      withProjectAnalysisWorkerSlot(async () => {
        runningTaskCount += 1;
        peakRunningTaskCount = Math.max(peakRunningTaskCount, runningTaskCount);
        await release.promise;
        runningTaskCount -= 1;
      }),
    );

    await yieldToEventLoop();
    expect(peakRunningTaskCount).toBe(concurrency);
    releases.forEach((release) => release.resolve());
    await Promise.all(tasks);
  });

  it("releases a slot after failure", async () => {
    await expect(
      withProjectAnalysisWorkerSlot(async () => {
        throw new Error("failed");
      }),
    ).rejects.toThrow("failed");
    await expect(withProjectAnalysisWorkerSlot(async () => "after")).resolves.toBe("after");
  });

  it("rejects an aborted caller without running its task", async () => {
    let didRunTask = false;
    await expect(
      withProjectAnalysisWorkerSlot(async () => {
        didRunTask = true;
      }, AbortSignal.abort()),
    ).rejects.toThrow("cancelled");
    expect(didRunTask).toBe(false);
  });

  it("removes a caller cancelled while waiting without leaking a slot", async () => {
    const concurrency = resolveProjectAnalysisConcurrency();
    const heldRelease = createDeferred<void>();
    const heldTasks = Array.from({ length: concurrency }, () =>
      withProjectAnalysisWorkerSlot(() => heldRelease.promise),
    );
    await yieldToEventLoop();

    const abortController = new AbortController();
    let didRunCancelledTask = false;
    const cancelledTask = withProjectAnalysisWorkerSlot(async () => {
      didRunCancelledTask = true;
    }, abortController.signal);
    abortController.abort();

    await expect(cancelledTask).rejects.toThrow("cancelled");
    expect(didRunCancelledTask).toBe(false);
    heldRelease.resolve();
    await Promise.all(heldTasks);
    await expect(withProjectAnalysisWorkerSlot(async () => "after")).resolves.toBe("after");
  });
});
