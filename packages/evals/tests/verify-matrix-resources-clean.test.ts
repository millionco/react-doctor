import { describe, expect, it } from "vite-plus/test";

import { verifyMatrixResourcesClean } from "../src/utils/verify-matrix-resources-clean.js";

describe("verifyMatrixResourcesClean", () => {
  it("stops polling at the hard cleanup verification deadline", async () => {
    const daytona = {
      list: async function* () {
        yield { id: "still-present" };
      },
      snapshot: {
        get: async () => ({ name: "still-present" }),
      },
    };

    await expect(
      verifyMatrixResourcesClean({
        daytona,
        evaluationId: "evaluation-id",
        snapshotName: "snapshot-name",
        deadlineMilliseconds: globalThis.performance.now() + 5,
      }),
    ).rejects.toThrow("Timed out verifying exact matrix Daytona resource cleanup");
  });
});
