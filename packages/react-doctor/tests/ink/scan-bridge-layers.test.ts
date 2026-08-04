import * as Effect from "effect/Effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { progressHandleForStore } from "../../src/cli/ink/scan-bridge-layers.js";
import { createScanStore } from "../../src/cli/ink/scan-store.js";

describe("progressHandleForStore", () => {
  afterEach(() => vi.useRealTimers());

  it("keeps transformed workspace progress visible when a project stops", () => {
    vi.useFakeTimers();
    const store = createScanStore();
    const handle = progressHandleForStore(store, {
      transformText: (displayText) => `web: ${displayText}`,
      shouldClearOnStop: false,
    })("Scanning...");

    Effect.runSync(handle.update("Scanning files (100/200)..."));
    vi.runAllTimers();
    expect(store.getSnapshot().progress).toBe("web: Scanning files (100/200)...");

    Effect.runSync(handle.stop());
    expect(store.getSnapshot().progress).toBe("web: Scanning...");
  });

  it("coalesces concurrent file progress into one store update per interval", () => {
    vi.useFakeTimers();
    const store = createScanStore();
    let notificationCount = 0;
    store.subscribe(() => {
      notificationCount += 1;
    });
    const handle = progressHandleForStore(store)("Scanning...");
    notificationCount = 0;

    Effect.runSync(handle.update("Scanning files (1/200)..."));
    Effect.runSync(handle.update("Scanning files (2/200)..."));
    Effect.runSync(handle.update("Scanning files (3/200)..."));

    expect(notificationCount).toBe(0);
    vi.runAllTimers();
    expect(notificationCount).toBe(1);
    expect(store.getSnapshot().progress).toBe("Scanning files (3/200)...");
  });

  it("does not commit stale progress after a scan settles", () => {
    vi.useFakeTimers();
    const store = createScanStore();
    const handle = progressHandleForStore(store)("Scanning...");
    Effect.runSync(handle.update("Scanning files (1/200)..."));
    Effect.runSync(handle.succeed("Scan complete"));

    vi.runAllTimers();
    expect(store.getSnapshot().progress).toBe("Scan complete");
  });
});
