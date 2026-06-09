#!/usr/bin/env node
// Aggregate a model's per-task SlopBench reports into one scorecard.
//
// After a `pier run`, each task leaves a slop-report.json under the run's logs.
// This walks a logs directory, collects every slop-report.json, and emits a
// results JSON: functional pass-rate, mean slop score, mean reward, and
// per-dimension means — the shape a (v2) leaderboard renders.
//
// Usage:
//   node scripts/aggregate-results.mjs --logs <dir> --model <name> [--out <file>]
import * as fs from "node:fs";
import * as path from "node:path";

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index++;
    } else {
      args[key] = true;
    }
  }
  return args;
};

const findReports = (root) => {
  const found = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "slop-report.json") found.push(full);
    }
  };
  walk(root);
  return found;
};

const mean = (values) =>
  values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;

const main = () => {
  const args = parseArgs(process.argv.slice(2));
  const logsDir = args.logs;
  const model = args.model ?? "unknown-model";
  if (!logsDir) {
    process.stderr.write(
      "usage: aggregate-results.mjs --logs <dir> --model <name> [--out <file>]\n",
    );
    process.exit(2);
  }

  const reportPaths = findReports(logsDir);
  const tasks = [];
  const dimensionScores = new Map();

  for (const reportPath of reportPaths) {
    let report;
    try {
      report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    } catch {
      continue;
    }
    const taskId = path.basename(path.dirname(path.dirname(reportPath)));
    tasks.push({
      task: taskId,
      slopScore: report.slopScore,
      functionalPass: report.functionalPass,
      reward: report.reward,
      violationCount: Array.isArray(report.violations) ? report.violations.length : 0,
    });
    for (const dimension of report.dimensions ?? []) {
      const bucket = dimensionScores.get(dimension.dimension) ?? [];
      bucket.push(dimension.score);
      dimensionScores.set(dimension.dimension, bucket);
    }
  }

  const passed = tasks.filter((task) => task.functionalPass === true).length;
  const rewards = tasks.map((task) => task.reward).filter((value) => typeof value === "number");
  const perDimensionMean = {};
  for (const [dimension, scores] of dimensionScores) perDimensionMean[dimension] = mean(scores);

  const result = {
    model,
    generatedAt: new Date().toISOString(),
    taskCount: tasks.length,
    functionalPassRate: tasks.length === 0 ? null : passed / tasks.length,
    meanSlopScore: mean(tasks.map((task) => task.slopScore)),
    meanReward: mean(rewards),
    perDimensionMean,
    tasks: tasks.sort((left, right) => left.task.localeCompare(right.task)),
  };

  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(args.out, output);
    process.stderr.write(`wrote ${args.out} (${tasks.length} tasks)\n`);
  } else {
    process.stdout.write(output);
  }
};

main();
