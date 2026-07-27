import { Daytona, DaytonaNotFoundError, SandboxState } from "@daytona/sdk";
import { describe, expect, it, vi } from "vite-plus/test";

import { cleanupEvaluationSandboxes } from "../src/cleanup-evaluation-sandboxes.js";

interface CreateDaytonaInput {
  deleteSandbox: () => Promise<void>;
  getSandbox: () => Promise<unknown>;
}

const createDaytona = ({ deleteSandbox, getSandbox }: CreateDaytonaInput): Daytona => {
  const daytona = new Daytona({ apiKey: "test" });
  Object.defineProperties(daytona, {
    list: {
      value: async function* () {
        yield { id: "sandbox-id", state: "started" };
      },
    },
    delete: { value: deleteSandbox },
    get: { value: getSandbox },
  });
  return daytona;
};

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

    await expect(
      cleanupEvaluationSandboxes({ daytona, evaluationId: "evaluation-id" }),
    ).resolves.toBeUndefined();
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

    await expect(
      cleanupEvaluationSandboxes({ daytona, evaluationId: "evaluation-id" }),
    ).resolves.toBeUndefined();
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

    await expect(
      cleanupEvaluationSandboxes({ daytona, evaluationId: "evaluation-id" }),
    ).rejects.toThrow("Failed to clean up 1 Daytona sandboxes");
  });
});
