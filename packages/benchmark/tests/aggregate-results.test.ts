import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

const AGGREGATOR = path.resolve(import.meta.dirname, "..", "scripts", "aggregate-results.mjs");

const createdDirectories: string[] = [];

// Writes a per-task slop-report.json under <logs>/<taskId>/verifier/, matching
// the layout the aggregator walks (task id = grandparent dir of the report).
const writeReport = (logsDir: string, taskId: string, report: Record<string, unknown>): void => {
  const dir = path.join(logsDir, taskId, "verifier");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "slop-report.json"), JSON.stringify(report));
};

const makeLogsDir = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slopbench-agg-"));
  createdDirectories.push(dir);
  return dir;
};

const runAggregator = (logsDir: string, model: string): Record<string, unknown> => {
  const outPath = path.join(logsDir, "result.json");
  execFileSync("node", [AGGREGATOR, "--logs", logsDir, "--model", model, "--out", outPath], {
    stdio: "ignore",
  });
  return JSON.parse(fs.readFileSync(outPath, "utf8"));
};

afterAll(() => {
  for (const dir of createdDirectories) fs.rmSync(dir, { recursive: true, force: true });
});

describe("aggregate-results", () => {
  it("aggregates pass-rate, mean score, mean reward, and per-dimension means", () => {
    const logsDir = makeLogsDir();
    writeReport(logsDir, "task-a", {
      slopScore: 100,
      functionalPass: true,
      reward: 1,
      violations: [],
      dimensions: [
        { dimension: "react-correctness", score: 100, violationCount: 0, weightedPenalty: 0 },
        { dimension: "ts-strictness", score: 100, violationCount: 0, weightedPenalty: 0 },
      ],
    });
    writeReport(logsDir, "task-b", {
      slopScore: 80,
      functionalPass: false,
      reward: 0,
      violations: [{ ruleId: "ts/no-explicit-any" }],
      dimensions: [
        { dimension: "react-correctness", score: 100, violationCount: 0, weightedPenalty: 0 },
        { dimension: "ts-strictness", score: 60, violationCount: 1, weightedPenalty: 40 },
      ],
    });

    const result = runAggregator(logsDir, "demo-model");

    expect(result.model).toBe("demo-model");
    expect(result.taskCount).toBe(2);
    expect(result.functionalPassRate).toBe(0.5);
    expect(result.meanSlopScore).toBe(90);
    expect(result.meanReward).toBe(0.5);
    const perDimensionMean = result.perDimensionMean as Record<string, number>;
    expect(perDimensionMean["react-correctness"]).toBe(100);
    expect(perDimensionMean["ts-strictness"]).toBe(80);
    const tasks = result.tasks as Array<{ task: string }>;
    expect(tasks.map((task) => task.task)).toEqual(["task-a", "task-b"]);
  });

  it("reports nulls for an empty logs directory", () => {
    const result = runAggregator(makeLogsDir(), "empty-model");
    expect(result.taskCount).toBe(0);
    expect(result.functionalPassRate).toBe(null);
    expect(result.meanSlopScore).toBe(null);
  });
});
