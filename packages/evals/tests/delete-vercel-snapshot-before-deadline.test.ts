import { Snapshot } from "@vercel/sandbox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { deleteVercelSnapshotBeforeDeadline } from "../src/utils/delete-vercel-snapshot-before-deadline.js";
const CONTROL_PLANE_TEST_TIMEOUT_MS = 5;
afterEach(() => vi.restoreAllMocks());

describe("deleteVercelSnapshotBeforeDeadline", () => {
  it("recovers snapshots when the create response was lost", async () => {
    const deleteSnapshot = vi.fn(async () => undefined);
    vi.spyOn(Snapshot, "get").mockResolvedValue(
      Object.assign(Object.create(null), { delete: deleteSnapshot }),
    );
    vi.spyOn(Snapshot, "list").mockResolvedValue(
      Object.assign(Object.create(null), {
        async *[Symbol.asyncIterator]() {
          yield { id: "recovered", status: "created" };
        },
      }),
    );
    await expect(
      deleteVercelSnapshotBeforeDeadline({
        credentials: {},
        snapshotName: "builder",
        deadlineMilliseconds: globalThis.performance.now() + CONTROL_PLANE_TEST_TIMEOUT_MS,
      }),
    ).resolves.toBeUndefined();
    expect(deleteSnapshot).toHaveBeenCalledOnce();
  });
  it("times out a never-settling snapshot deletion", async () => {
    const snapshot = Object.create(Snapshot.prototype);
    Object.defineProperties(snapshot, {
      snapshotId: { value: "snapshot-name" },
      delete: { value: () => new Promise<never>(() => undefined) },
    });
    await expect(
      deleteVercelSnapshotBeforeDeadline({
        credentials: {},
        snapshotName: "builder",
        snapshot,
        deadlineMilliseconds: globalThis.performance.now() + CONTROL_PLANE_TEST_TIMEOUT_MS,
      }),
    ).rejects.toThrow("Timed out deleting Vercel snapshot snapshot-name");
  });
});
