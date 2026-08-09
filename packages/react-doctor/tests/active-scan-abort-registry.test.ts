import { describe, expect, it } from "vite-plus/test";
import { activeScanAbortRegistry } from "../src/cli/utils/active-scan-abort-registry.js";

describe("activeScanAbortRegistry", () => {
  it("aborts every registered scan and forgets unregistered scans", () => {
    const activeController = new AbortController();
    const secondActiveController = new AbortController();
    const unregisteredController = new AbortController();
    const unregister = activeScanAbortRegistry.register(unregisteredController);
    unregister();
    activeScanAbortRegistry.register(activeController);
    activeScanAbortRegistry.register(secondActiveController);

    activeScanAbortRegistry.abortAll();

    expect(activeController.signal.aborted).toBe(true);
    expect(secondActiveController.signal.aborted).toBe(true);
    expect(unregisteredController.signal.aborted).toBe(false);
  });

  it("leaves controllers registered during abort callbacks active", () => {
    const activeController = new AbortController();
    const registeredDuringAbortController = new AbortController();
    activeController.signal.addEventListener("abort", () => {
      activeScanAbortRegistry.register(registeredDuringAbortController);
    });
    activeScanAbortRegistry.register(activeController);

    activeScanAbortRegistry.abortAll();

    expect(activeController.signal.aborted).toBe(true);
    expect(registeredDuringAbortController.signal.aborted).toBe(false);

    activeScanAbortRegistry.abortAll();
    expect(registeredDuringAbortController.signal.aborted).toBe(true);
  });
});
