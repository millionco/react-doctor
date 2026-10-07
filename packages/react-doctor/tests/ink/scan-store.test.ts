import { describe, expect, it } from "vite-plus/test";
import { createScanStore } from "../../src/cli/ink/scan-store.js";

describe("createScanStore", () => {
  it("does not notify listeners added during the current commit", () => {
    const store = createScanStore();
    const notifications: string[] = [];
    store.subscribe(() => {
      notifications.push("first");
      store.subscribe(() => notifications.push("late"));
    });

    store.setProgress("first update");
    expect(notifications).toEqual(["first"]);

    store.setProgress("second update");
    expect(notifications).toEqual(["first", "first", "late"]);
  });

  it("replaces settled phase data instead of retaining stale state", () => {
    const store = createScanStore();
    store.setReport({
      diagnostics: [],
      score: null,
      projectedScore: null,
      projectName: "web",
      rootDirectory: "/project",
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });
    store.setSummary({
      projects: [],
      aggregateScore: null,
      projectedScore: null,
      combinedDiagnostics: [],
      scannedFileCount: 1,
      elapsedMilliseconds: 10,
      projectName: "workspace",
      rootDirectory: "/project",
      isOffline: true,
      noScoreMessage: "Score unavailable.",
    });

    expect(store.getSnapshot()).not.toHaveProperty("report");
    expect(store.getSnapshot()).toMatchObject({ phase: "summary" });
  });
});
