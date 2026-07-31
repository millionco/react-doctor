import { Daytona, DaytonaNotFoundError, SandboxState } from "@daytona/sdk";
import { describe, expect, it, vi } from "vite-plus/test";

import { cleanupEvaluationSandboxes } from "../src/cleanup-evaluation-sandboxes.js";

interface CreateDaytonaInput {
  deleteSandbox: () => Promise<void>;
  getSandbox: () => Promise<unknown>;
  listSandboxes?: () => AsyncIterable<unknown>;
}

const CONTROL_PLANE_TEST_TIMEOUT_MS = 5;
const CLEANUP_TEST_TIMEOUT_MS = 1_000;

const createDaytona = ({
  deleteSandbox,
  getSandbox,
  listSandboxes,
}: CreateDaytonaInput): Daytona => {
  const daytona = new Daytona({ apiKey: "test" });
  Object.defineProperties(daytona, {
    list: {
      value:
        listSandboxes ??
        async function* () {
          yield { id: "sandbox-id", state: "started" };
        },
    },
    delete: { value: deleteSandbox },
    get: { value: getSandbox },
  });
  return daytona;
};

const cleanup = (daytona: Daytona, timeoutMilliseconds = CLEANUP_TEST_TIMEOUT_MS) =>
  cleanupEvaluationSandboxes({
    daytona,
    evaluationId: "evaluation-id",
    deadlineMilliseconds: globalThis.performance.now() + timeoutMilliseconds,
  });

describe("cleanupEvaluationSandboxes", () => {
  it("accepts a sandbox that entered destroying after a delete race", async () => {
    const daytona = createDaytona({
      deleteSandbox: vi.fn(async () => {
        throw new Error("Sandbox state change in progress");
      }),
      getSandbox: vi.fn(async () => ({
        id: "sandbox-id",
        state: SandboxState.DESTROYING,
      })),
    });

    await expect(cleanup(daytona)).resolves.toBeUndefined();
  });

  it("accepts a sandbox deleted before recovery", async () => {
    const daytona = createDaytona({
      deleteSandbox: vi.fn(async () => {
        throw new Error("Sandbox state change in progress");
      }),
      getSandbox: vi.fn(async () => {
        throw new DaytonaNotFoundError("Sandbox not found", 404);
      }),
    });

    await expect(cleanup(daytona)).resolves.toBeUndefined();
  });

  it("fails when a sandbox remains started after deletion fails", async () => {
    const daytona = createDaytona({
      deleteSandbox: vi.fn(async () => {
        throw new Error("Daytona capacity exhausted");
      }),
      getSandbox: vi.fn(async () => ({
        id: "sandbox-id",
        state: "started",
      })),
    });

    await expect(cleanup(daytona)).rejects.toThrow("Failed to clean up 1 Daytona sandboxes");
  });

  it("times out a never-settling sandbox list", async () => {
    const daytona = createDaytona({
      listSandboxes: async function* () {
        await new Promise<never>(() => undefined);
        yield { id: "unreachable", state: "started" };
      },
      deleteSandbox: vi.fn(async () => undefined),
      getSandbox: vi.fn(async () => undefined),
    });

    await expect(cleanup(daytona, CONTROL_PLANE_TEST_TIMEOUT_MS)).rejects.toThrow(
      "Timed out listing Daytona sandboxes for cleanup",
    );
  });

  it("rejects when delete recovery never settles", async () => {
    const daytona = createDaytona({
      deleteSandbox: vi.fn(async () => {
        throw new Error("delete failed");
      }),
      getSandbox: vi.fn(() => new Promise<never>(() => undefined)),
    });

    await expect(cleanup(daytona, CONTROL_PLANE_TEST_TIMEOUT_MS)).rejects.toThrow(
      "Failed to clean up 1 Daytona sandboxes",
    );
  });

  it("rejects when sandbox deletion never settles", async () => {
    const daytona = createDaytona({
      deleteSandbox: vi.fn(() => new Promise<never>(() => undefined)),
      getSandbox: vi.fn(async () => ({ id: "sandbox-id", state: "started" })),
    });

    await expect(cleanup(daytona, CONTROL_PLANE_TEST_TIMEOUT_MS)).rejects.toThrow(
      "Failed to clean up 1 Daytona sandboxes",
    );
  });
});
