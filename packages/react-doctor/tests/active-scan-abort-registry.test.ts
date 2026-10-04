import { describe, expect, it } from "vite-plus/test";
import { activeScanAbortRegistry } from "../src/cli/utils/active-scan-abort-registry.js";

describe("activeScanAbortRegistry", () => {
  it("aborts every registered scan and forgets unregistered scans", async () => {
    const activeController = new AbortController();
    const secondActiveController = new AbortController();
    const unregisteredController = new AbortController();
    const unregister = activeScanAbortRegistry.register(unregisteredController);
    unregister();
    activeScanAbortRegistry.register(activeController);
    activeScanAbortRegistry.register(secondActiveController);

    await activeScanAbortRegistry.abortAll();

    expect(activeController.signal.aborted).toBe(true);
    expect(secondActiveController.signal.aborted).toBe(true);
    expect(unregisteredController.signal.aborted).toBe(false);
  });

  it("leaves controllers registered during abort callbacks active", async () => {
    const activeController = new AbortController();
    const registeredDuringAbortController = new AbortController();
    activeController.signal.addEventListener("abort", () => {
      activeScanAbortRegistry.register(registeredDuringAbortController);
    });
    activeScanAbortRegistry.register(activeController);

    await activeScanAbortRegistry.abortAll();

    expect(activeController.signal.aborted).toBe(true);
    expect(registeredDuringAbortController.signal.aborted).toBe(false);

    await activeScanAbortRegistry.abortAll();
    expect(registeredDuringAbortController.signal.aborted).toBe(true);
  });

  it("waits for registered cleanup work", async () => {
    let didFinishCleanup = false;
    activeScanAbortRegistry.registerCleanup(async () => {
      await Promise.resolve();
      didFinishCleanup = true;
    });

    await activeScanAbortRegistry.abortAll();

    expect(didFinishCleanup).toBe(true);
  });
});
