import { APIError, Sandbox, Snapshot } from "@vercel/sandbox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { verifyEvaluationResourcesClean } from "../src/utils/verify-evaluation-resources-clean.js";
const CONTROL_PLANE_TEST_TIMEOUT_MS = 5;
afterEach(() => vi.restoreAllMocks());
const verify = () =>
  verifyEvaluationResourcesClean({
    credentials: {},
    evaluationId: "evaluation-id",
    snapshotId: "snapshot-name",
    snapshotName: "builder",
    deadlineMilliseconds: globalThis.performance.now() + CONTROL_PLANE_TEST_TIMEOUT_MS,
  });
describe("verifyEvaluationResourcesClean", () => {
  it("times out a never-settling resource list", async () => {
    vi.spyOn(Sandbox, "list").mockImplementation(() => new Promise<never>(() => undefined));
    await expect(verify()).rejects.toThrow("Timed out verifying exact Vercel resource cleanup");
  });
  it("verifies both the sandbox list and snapshot deletion", async () => {
    vi.spyOn(Sandbox, "list").mockResolvedValue(
      Object.assign(Object.create(null), { async *[Symbol.asyncIterator]() {} }),
    );
    vi.spyOn(Snapshot, "get").mockRejectedValue(new APIError(new Response(null, { status: 404 })));
    await expect(verify()).resolves.toBeUndefined();
  });
});
