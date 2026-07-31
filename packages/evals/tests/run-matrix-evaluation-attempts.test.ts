import { describe, expect, it, vi } from "vite-plus/test";

import type { MatrixEvaluationLane } from "../src/build-matrix-evaluation-plan.js";
import { runMatrixEvaluationAttempts } from "../src/run-matrix-evaluation-attempts.js";

const buildLane = (id: string): MatrixEvaluationLane => ({
  id,
  kind: id === "matrix-base" ? "base" : "treatment",
  reactDoctorRepository: "https://github.com/example/react-doctor.git",
  reactDoctorRef: "a".repeat(40),
  ruleKeys: [],
  reactDoctorWorkDirectory: `/workspace/${id}`,
  provenancePath: `/workspace/${id}.json`,
  targetWorkDirectory: `/workspace/target-${id}`,
  reportPath: `/tmp/${id}.json`,
});

describe("runMatrixEvaluationAttempts", () => {
  it("retries only the failed lane-project and preserves successful siblings", async () => {
    const lanes = [buildLane("matrix-base"), buildLane("pr-1"), buildLane("pr-2")];
    const evaluateRepositoryBatch = vi
      .fn()
      .mockResolvedValueOnce([
        {
          laneId: "pr-2",
          record: {
            schemaVersion: 1,
            repository: {
              org: "example",
              name: "repository",
              ref: "f".repeat(40),
              rootDir: ".",
            },
            error: "retry me",
          },
        },
      ])
      .mockResolvedValueOnce([]);
    const beforeRetry = vi.fn(async () => undefined);
    const onFinalFailure = vi.fn(async () => undefined);

    await runMatrixEvaluationAttempts({
      repositoryGroups: [
        {
          org: "example",
          name: "repository",
          ref: "e".repeat(40),
          rootDirectories: ["."],
        },
      ],
      lanes,
      repositoriesPerSandbox: 10,
      attemptConcurrencies: [100, 50],
      evaluateRepositoryBatch,
      beforeRetry,
      onBeforeRetryFailure: vi.fn(),
      onRetry: vi.fn(),
      onFinalFailure,
    });

    expect(evaluateRepositoryBatch).toHaveBeenCalledTimes(2);
    expect(
      evaluateRepositoryBatch.mock.calls[0][1].map((lane: MatrixEvaluationLane) => lane.id),
    ).toEqual(["matrix-base", "pr-1", "pr-2"]);
    expect(
      evaluateRepositoryBatch.mock.calls[1][1].map((lane: MatrixEvaluationLane) => lane.id),
    ).toEqual(["pr-2"]);
    expect(evaluateRepositoryBatch.mock.calls[1][0]).toEqual([
      {
        org: "example",
        name: "repository",
        ref: "f".repeat(40),
        rootDirectories: ["."],
      },
    ]);
    expect(beforeRetry).toHaveBeenCalledOnce();
    expect(onFinalFailure).not.toHaveBeenCalled();
  });

  it("contains a rejected batch with allSettled and continues sibling work", async () => {
    const lane = buildLane("pr-1");
    const finalFailures: unknown[] = [];
    const evaluateRepositoryBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("sandbox exploded"))
      .mockResolvedValueOnce([]);

    await runMatrixEvaluationAttempts({
      repositoryGroups: [
        { org: "a", name: "one", ref: "1".repeat(40), rootDirectories: ["."] },
        { org: "b", name: "two", ref: "2".repeat(40), rootDirectories: ["."] },
      ],
      lanes: [lane],
      repositoriesPerSandbox: 1,
      attemptConcurrencies: [2],
      evaluateRepositoryBatch,
      beforeRetry: async () => undefined,
      onBeforeRetryFailure: vi.fn(),
      onRetry: vi.fn(),
      onFinalFailure: async (failure) => {
        finalFailures.push(failure);
      },
    });

    expect(evaluateRepositoryBatch).toHaveBeenCalledTimes(2);
    expect(finalFailures).toEqual([
      expect.objectContaining({
        laneId: "pr-1",
        record: expect.objectContaining({ error: "sandbox exploded" }),
      }),
    ]);
  });
});
