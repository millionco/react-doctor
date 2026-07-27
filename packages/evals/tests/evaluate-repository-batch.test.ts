import { Daytona, Sandbox } from "@daytona/sdk";
import { describe, expect, it, vi } from "vite-plus/test";

import { SANDBOX_REPORT_PATH } from "../src/constants.js";
import { evaluateRepositoryBatch } from "../src/evaluate-repository-batch.js";

const buildReport = () => ({
  schemaVersion: 3,
  version: "0.8.1",
  ok: true,
  directory: "/workspace/target",
  mode: "full",
  diff: null,
  projects: [
    {
      directory: "/workspace/target",
      packageRoot: "/workspace/target",
      framework: "nextjs",
      project: {},
      diagnostics: [],
      score: null,
      skippedChecks: [],
      analyzedFiles: [],
      analyzedFileCount: 0,
      complete: true,
      elapsedMilliseconds: 1,
    },
  ],
  diagnostics: [],
  summary: {
    errorCount: 0,
    warningCount: 0,
    affectedFileCount: 0,
    totalDiagnosticCount: 0,
    score: null,
    scoreLabel: null,
  },
  elapsedMilliseconds: 1,
  error: null,
});

describe("evaluateRepositoryBatch", () => {
  it("downloads the report file instead of parsing truncated command output", async () => {
    const report = buildReport();
    const executeCommand = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, result: "" })
      .mockResolvedValueOnce({ exitCode: 0, result: "a".repeat(40) })
      .mockResolvedValueOnce({ exitCode: 0, result: '{"ok":true' });
    const downloadFile = vi.fn(async () => Buffer.from(JSON.stringify(report)));
    const sandbox = Object.create(Sandbox.prototype);
    Object.defineProperties(sandbox, {
      id: { value: "sandbox-id" },
      process: { value: { executeCommand } },
      fs: { value: { downloadFile } },
    });
    const daytona = new Daytona({ apiKey: "test" });
    Object.defineProperty(daytona, "delete", { value: vi.fn(async () => undefined) });
    const records: unknown[] = [];

    const failedRecords = await evaluateRepositoryBatch({
      daytona,
      createSandbox: async () => sandbox,
      repositoryGroups: [
        {
          org: "example",
          name: "repository",
          ref: "b".repeat(40),
          rootDirectories: ["."],
        },
      ],
      evaluationDeadlineMilliseconds: globalThis.performance.now() + 60_000,
      onRecord: async (record) => {
        records.push(record);
      },
    });

    expect(failedRecords).toEqual([]);
    expect(downloadFile).toHaveBeenCalledWith(SANDBOX_REPORT_PATH, expect.any(Number));
    expect(records).toEqual([
      {
        schemaVersion: 1,
        repository: {
          org: "example",
          name: "repository",
          ref: "a".repeat(40),
          rootDir: ".",
        },
        report,
      },
    ]);
  });
});
