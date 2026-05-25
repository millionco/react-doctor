import { describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "@react-doctor/core";
import { OXLINT_MAX_CONCURRENT_BATCHES_COUNT } from "../src/constants.js";
import { spawnLintBatches } from "../src/runners/oxlint/spawn-batches.js";

const sampleProject: ProjectInfo = {
  rootDirectory: "/repo",
  projectName: "sample-app",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  hasReactNativeWorkspace: false,
  sourceFileCount: 6,
};

const emptyOxlintOutput = JSON.stringify({
  diagnostics: [],
  number_of_files: 1,
  number_of_rules: 1,
});

const SPAWN_BATCH_TEST_DELAY_MS = 25;

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

describe("spawnLintBatches", () => {
  it("runs independent batches with bounded concurrency", async () => {
    let activeBatchCount = 0;
    let maxActiveBatchCount = 0;

    await spawnLintBatches({
      baseArgs: ["oxlint", "-c", "oxlintrc.json"],
      fileBatches: [["src/a.tsx"], ["src/b.tsx"], ["src/c.tsx"], ["src/d.tsx"], ["src/e.tsx"]],
      rootDirectory: "/repo",
      nodeBinaryPath: process.execPath,
      project: sampleProject,
      spawnOxlintProcess: async () => {
        activeBatchCount += 1;
        maxActiveBatchCount = Math.max(maxActiveBatchCount, activeBatchCount);
        await sleep(SPAWN_BATCH_TEST_DELAY_MS);
        activeBatchCount -= 1;
        return emptyOxlintOutput;
      },
    });

    expect(maxActiveBatchCount).toBeGreaterThan(1);
    expect(maxActiveBatchCount).toBeLessThanOrEqual(OXLINT_MAX_CONCURRENT_BATCHES_COUNT);
  });
});
