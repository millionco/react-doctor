import { APIError, Sandbox } from "@vercel/sandbox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanupEvaluationSandboxes } from "../src/cleanup-evaluation-sandboxes.js";

const CONTROL_PLANE_TEST_TIMEOUT_MS = 5;
const CLEANUP_TEST_TIMEOUT_MS = 1_000;
const sandbox = Object.create(Sandbox.prototype);
const deleteSandbox = vi.fn(async () => undefined);
Object.defineProperty(sandbox, "delete", { value: deleteSandbox });
const cleanup = (timeoutMilliseconds = CLEANUP_TEST_TIMEOUT_MS) =>
  cleanupEvaluationSandboxes({
    credentials: {},
    evaluationId: "evaluation-id",
    deadlineMilliseconds: globalThis.performance.now() + timeoutMilliseconds,
  });
const mockSandboxes = () => {
  vi.spyOn(Sandbox, "list").mockResolvedValue(
    Object.assign(Object.create(null), { toArray: async () => [{ name: "sandbox-id" }] }),
  );
  vi.spyOn(Sandbox, "get").mockResolvedValue(sandbox);
};
afterEach(() => {
  vi.restoreAllMocks();
  deleteSandbox.mockReset();
});
describe("cleanupEvaluationSandboxes", () => {
  it("deletes only sandboxes tagged with this evaluation", async () => {
    mockSandboxes();
    await cleanup();
    expect(Sandbox.list).toHaveBeenCalledWith({ tags: { evaluation: "evaluation-id" } });
    expect(deleteSandbox).toHaveBeenCalledOnce();
  });
  it("accepts a sandbox deleted before recovery", async () => {
    mockSandboxes();
    vi.mocked(Sandbox.get).mockRejectedValue(new APIError(new Response(null, { status: 404 })));
    await expect(cleanup()).resolves.toBeUndefined();
  });
  it("fails when deletion fails", async () => {
    mockSandboxes();
    deleteSandbox.mockRejectedValue(new Error("delete failed"));
    await expect(cleanup()).rejects.toThrow("Failed to clean up 1 Vercel sandboxes");
  });
  it("times out a never-settling sandbox list", async () => {
    vi.spyOn(Sandbox, "list").mockImplementation(() => new Promise<never>(() => undefined));
    await expect(cleanup(CONTROL_PLANE_TEST_TIMEOUT_MS)).rejects.toThrow(
      "Timed out listing Vercel sandboxes for cleanup",
    );
  });
  it("rejects when sandbox recovery never settles", async () => {
    mockSandboxes();
    vi.mocked(Sandbox.get).mockImplementation(() => new Promise<never>(() => undefined));
    await expect(cleanup(CONTROL_PLANE_TEST_TIMEOUT_MS)).rejects.toThrow(
      "Failed to clean up 1 Vercel sandboxes",
    );
  });
  it("rejects when sandbox deletion never settles", async () => {
    mockSandboxes();
    deleteSandbox.mockImplementation(() => new Promise<never>(() => undefined));
    await expect(cleanup(CONTROL_PLANE_TEST_TIMEOUT_MS)).rejects.toThrow(
      "Failed to clean up 1 Vercel sandboxes",
    );
  });
});
