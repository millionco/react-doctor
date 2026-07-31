import { describe, expect, it, vi } from "vite-plus/test";

import type { MatrixEvaluationLane } from "../src/build-matrix-evaluation-plan.js";
import type { CorpusRepositoryGroup } from "../src/corpus.js";
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

const buildFailure = (laneId: string, repositoryGroup: CorpusRepositoryGroup, rootDir: string) => ({
  laneId,
  record: {
    schemaVersion: 1,
    repository: {
      org: repositoryGroup.org,
      name: repositoryGroup.name,
      ref: repositoryGroup.ref,
      rootDir,
    },
    error: "scan failed",
  },
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

  it("preserves multi-lane repository batches for shared infrastructure retries", async () => {
    const lanes = [buildLane("pr-1"), buildLane("pr-2")];
    const repositoryGroup = {
      org: "example",
      name: "repository",
      ref: "e".repeat(40),
      rootDirectories: ["packages/app", "packages/web"],
    };
    const failures = lanes.flatMap((lane) =>
      repositoryGroup.rootDirectories.map((rootDir) => ({
        laneId: lane.id,
        record: {
          schemaVersion: 1,
          repository: {
            org: repositoryGroup.org,
            name: repositoryGroup.name,
            ref: repositoryGroup.ref,
            rootDir,
          },
          error: "Daytona capacity exhausted",
        },
      })),
    );
    const evaluateRepositoryBatch = vi
      .fn()
      .mockResolvedValueOnce(failures)
      .mockResolvedValueOnce([]);
    const onRetry = vi.fn();

    await runMatrixEvaluationAttempts({
      repositoryGroups: [repositoryGroup],
      lanes,
      repositoriesPerSandbox: 10,
      attemptConcurrencies: [50, 10],
      evaluateRepositoryBatch,
      beforeRetry: async () => undefined,
      onBeforeRetryFailure: vi.fn(),
      onRetry,
      onFinalFailure: vi.fn(async () => undefined),
    });

    expect(evaluateRepositoryBatch).toHaveBeenCalledTimes(2);
    expect(evaluateRepositoryBatch.mock.calls[1][0]).toEqual([repositoryGroup]);
    expect(
      evaluateRepositoryBatch.mock.calls[1][1].map((lane: MatrixEvaluationLane) => lane.id),
    ).toEqual(["pr-1", "pr-2"]);
    expect(onRetry).toHaveBeenCalledWith({
      attemptNumber: 2,
      totalAttempts: 2,
      concurrency: 10,
      failedLaneProjectCount: 4,
    });
  });

  it("preserves rejected work as one multi-lane retry", async () => {
    const lanes = [buildLane("pr-1"), buildLane("pr-2")];
    const repositoryGroups = [
      { org: "a", name: "one", ref: "1".repeat(40), rootDirectories: ["."] },
      { org: "b", name: "two", ref: "2".repeat(40), rootDirectories: ["."] },
    ];
    const evaluateRepositoryBatch = vi
      .fn()
      .mockRejectedValueOnce(new Error("sandbox exploded"))
      .mockResolvedValueOnce([]);

    await runMatrixEvaluationAttempts({
      repositoryGroups,
      lanes,
      repositoriesPerSandbox: 10,
      attemptConcurrencies: [50, 10],
      evaluateRepositoryBatch,
      beforeRetry: async () => undefined,
      onBeforeRetryFailure: vi.fn(),
      onRetry: vi.fn(),
      onFinalFailure: vi.fn(async () => undefined),
    });

    expect(evaluateRepositoryBatch).toHaveBeenCalledTimes(2);
    expect(evaluateRepositoryBatch.mock.calls[1][0]).toEqual(repositoryGroups);
    expect(
      evaluateRepositoryBatch.mock.calls[1][1].map((lane: MatrixEvaluationLane) => lane.id),
    ).toEqual(["pr-1", "pr-2"]);
  });

  it("separates project roots with different failed lane sets", async () => {
    const lanes = [buildLane("pr-1"), buildLane("pr-2")];
    const repositoryGroup = {
      org: "example",
      name: "repository",
      ref: "e".repeat(40),
      rootDirectories: ["packages/app", "packages/web"],
    };
    const evaluateRepositoryBatch = vi.fn(
      async (
        _repositoryGroups: ReadonlyArray<CorpusRepositoryGroup>,
        _lanes: ReadonlyArray<MatrixEvaluationLane>,
        attemptIndex: number,
      ) =>
        attemptIndex === 0
          ? [
              buildFailure("pr-1", repositoryGroup, "packages/app"),
              buildFailure("pr-1", repositoryGroup, "packages/web"),
              buildFailure("pr-2", repositoryGroup, "packages/web"),
            ]
          : [],
    );

    await runMatrixEvaluationAttempts({
      repositoryGroups: [repositoryGroup],
      lanes,
      repositoriesPerSandbox: 10,
      attemptConcurrencies: [50, 10],
      evaluateRepositoryBatch,
      beforeRetry: async () => undefined,
      onBeforeRetryFailure: vi.fn(),
      onRetry: vi.fn(),
      onFinalFailure: vi.fn(async () => undefined),
    });

    expect(evaluateRepositoryBatch).toHaveBeenCalledTimes(3);
    expect(evaluateRepositoryBatch.mock.calls[1][0]).toEqual([
      { ...repositoryGroup, rootDirectories: ["packages/app"] },
    ]);
    expect(evaluateRepositoryBatch.mock.calls[1][1].map((lane) => lane.id)).toEqual(["pr-1"]);
    expect(evaluateRepositoryBatch.mock.calls[2][0]).toEqual([
      { ...repositoryGroup, rootDirectories: ["packages/web"] },
    ]);
    expect(evaluateRepositoryBatch.mock.calls[2][1].map((lane) => lane.id)).toEqual([
      "pr-1",
      "pr-2",
    ]);
  });

  it("deduplicates repeated failures for the same lane-project", async () => {
    const lane = buildLane("pr-1");
    const repositoryGroup = {
      org: "example",
      name: "repository",
      ref: "e".repeat(40),
      rootDirectories: ["."],
    };
    const failure = buildFailure(lane.id, repositoryGroup, ".");
    const evaluateRepositoryBatch = vi
      .fn()
      .mockResolvedValueOnce([failure, failure])
      .mockResolvedValueOnce([]);

    await runMatrixEvaluationAttempts({
      repositoryGroups: [repositoryGroup],
      lanes: [lane],
      repositoriesPerSandbox: 10,
      attemptConcurrencies: [50, 10],
      evaluateRepositoryBatch,
      beforeRetry: async () => undefined,
      onBeforeRetryFailure: vi.fn(),
      onRetry: vi.fn(),
      onFinalFailure: vi.fn(async () => undefined),
    });

    expect(evaluateRepositoryBatch).toHaveBeenCalledTimes(2);
    expect(evaluateRepositoryBatch.mock.calls[1][0]).toEqual([repositoryGroup]);
    expect(evaluateRepositoryBatch.mock.calls[1][1]).toEqual([lane]);
  });

  it("repartitions matching lane sets at the configured repository batch size", async () => {
    const lanes = [buildLane("pr-1"), buildLane("pr-2")];
    const repositoryGroups = Array.from({ length: 20 }, (_, repositoryIndex) => ({
      org: "example",
      name: `repository-${repositoryIndex.toString().padStart(2, "0")}`,
      ref: repositoryIndex.toString(16).padStart(40, "0"),
      rootDirectories: ["."],
    }));
    const evaluateRepositoryBatch = vi.fn(
      async (
        repositoryBatch: ReadonlyArray<CorpusRepositoryGroup>,
        activeLanes: ReadonlyArray<MatrixEvaluationLane>,
        attemptIndex: number,
      ) =>
        attemptIndex === 0
          ? repositoryBatch.flatMap((repositoryGroup) =>
              activeLanes.map((lane) => buildFailure(lane.id, repositoryGroup, ".")),
            )
          : [],
    );

    await runMatrixEvaluationAttempts({
      repositoryGroups,
      lanes,
      repositoriesPerSandbox: 10,
      attemptConcurrencies: [50, 10],
      evaluateRepositoryBatch,
      beforeRetry: async () => undefined,
      onBeforeRetryFailure: vi.fn(),
      onRetry: vi.fn(),
      onFinalFailure: vi.fn(async () => undefined),
    });

    const retryCalls = evaluateRepositoryBatch.mock.calls.filter(
      ([, , attemptIndex]) => attemptIndex === 1,
    );
    expect(retryCalls).toHaveLength(2);
    expect(retryCalls.map(([repositoryBatch]) => repositoryBatch.length)).toEqual([10, 10]);
    expect(retryCalls.map(([, activeLanes]) => activeLanes.map((lane) => lane.id))).toEqual([
      ["pr-1", "pr-2"],
      ["pr-1", "pr-2"],
    ]);
    expect(
      retryCalls.flatMap(([repositoryBatch]) => repositoryBatch.map((group) => group.name)).sort(),
    ).toEqual(repositoryGroups.map((group) => group.name).sort());
  });

  it("builds deterministic retries regardless of corpus and failure order", async () => {
    const lanes = [buildLane("pr-1"), buildLane("pr-2")];
    const repositoryGroups = [
      { org: "example", name: "alpha", ref: "a".repeat(40), rootDirectories: ["."] },
      { org: "example", name: "beta", ref: "b".repeat(40), rootDirectories: ["."] },
    ];
    const failures = [
      buildFailure("pr-2", repositoryGroups[1], "."),
      buildFailure("pr-1", repositoryGroups[0], "."),
      buildFailure("pr-1", repositoryGroups[1], "."),
    ];
    const runAndCollectRetries = async (
      corpus: ReadonlyArray<CorpusRepositoryGroup>,
      attemptFailures: ReadonlyArray<(typeof failures)[number]>,
    ) => {
      const evaluateRepositoryBatch = vi
        .fn()
        .mockResolvedValueOnce(attemptFailures)
        .mockResolvedValue([]);
      await runMatrixEvaluationAttempts({
        repositoryGroups: corpus,
        lanes,
        repositoriesPerSandbox: 10,
        attemptConcurrencies: [50, 10],
        evaluateRepositoryBatch,
        beforeRetry: async () => undefined,
        onBeforeRetryFailure: vi.fn(),
        onRetry: vi.fn(),
        onFinalFailure: vi.fn(async () => undefined),
      });
      return evaluateRepositoryBatch.mock.calls.slice(1).map(([repositoryBatch, activeLanes]) => ({
        repositoryBatch,
        laneIds: activeLanes.map((lane: MatrixEvaluationLane) => lane.id),
      }));
    };

    expect(await runAndCollectRetries(repositoryGroups, failures)).toEqual(
      await runAndCollectRetries([...repositoryGroups].reverse(), [...failures].reverse()),
    );
  });

  it("fails closed for an unknown retry lane", async () => {
    const lane = buildLane("pr-1");
    const repositoryGroup = {
      org: "example",
      name: "repository",
      ref: "e".repeat(40),
      rootDirectories: ["."],
    };

    await expect(
      runMatrixEvaluationAttempts({
        repositoryGroups: [repositoryGroup],
        lanes: [lane],
        repositoriesPerSandbox: 10,
        attemptConcurrencies: [50, 10],
        evaluateRepositoryBatch: async () => [buildFailure("missing-lane", repositoryGroup, ".")],
        beforeRetry: async () => undefined,
        onBeforeRetryFailure: vi.fn(),
        onRetry: vi.fn(),
        onFinalFailure: vi.fn(async () => undefined),
      }),
    ).rejects.toThrow("Unknown failed matrix lane: missing-lane");
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
