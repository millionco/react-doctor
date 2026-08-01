import { describe, expect, it, vi } from "vite-plus/test";

import { deleteDaytonaSnapshotBeforeDeadline } from "../src/utils/delete-daytona-snapshot-before-deadline.js";

const CONTROL_PLANE_TEST_TIMEOUT_MS = 5;

describe("deleteDaytonaSnapshotBeforeDeadline", () => {
  it("times out a never-settling snapshot recovery", async () => {
    await expect(
      deleteDaytonaSnapshotBeforeDeadline({
        snapshotClient: {
          get: vi.fn(() => new Promise<never>(() => undefined)),
          delete: vi.fn(async () => undefined),
        },
        snapshotName: "snapshot-name",
        deadlineMilliseconds: globalThis.performance.now() + CONTROL_PLANE_TEST_TIMEOUT_MS,
      }),
    ).rejects.toThrow("Timed out recovering Daytona snapshot snapshot-name");
  });

  it("times out a never-settling snapshot deletion", async () => {
    await expect(
      deleteDaytonaSnapshotBeforeDeadline({
        snapshotClient: {
          get: vi.fn(async () => ({ name: "snapshot-name" })),
          delete: vi.fn(() => new Promise<never>(() => undefined)),
        },
        snapshotName: "snapshot-name",
        deadlineMilliseconds: globalThis.performance.now() + CONTROL_PLANE_TEST_TIMEOUT_MS,
      }),
    ).rejects.toThrow("Timed out deleting Daytona snapshot snapshot-name");
  });
});
