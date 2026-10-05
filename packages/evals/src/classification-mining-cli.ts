import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { z } from "zod";

import { classificationResultSchema } from "./classification-schema.js";
import {
  CLASSIFICATION_CONCURRENCY,
  CLASSIFICATION_LIMIT,
  CLASSIFICATION_SILENT_FILES_PER_PROJECT,
  EVALUATION_ARTIFACT_FILE_MODE,
  FAILURE_EXIT_CODE,
  MILLISECONDS_PER_MINUTE,
} from "./constants.js";
import { readNdjson } from "./utils/read-ndjson.js";
import { serializeNdjsonRecord } from "./utils/serialize-ndjson-record.js";
import { toErrorMessage } from "./utils/to-error-message.js";

const runStep = (script: string, args: string[], output?: number): Promise<number> =>
  new Promise((resolveStep, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", fileURLToPath(new URL(script, import.meta.url)), ...args],
      { stdio: ["ignore", output ?? "inherit", "inherit"] },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Mining step terminated by ${signal}`));
      else resolveStep(code ?? FAILURE_EXIT_CODE);
    });
  });

const main = async (): Promise<void> => {
  const { values, positionals: evalArguments } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: "string", default: ".fpfn" },
      input: { type: "string" },
      rules: { type: "string" },
      "interval-minutes": { type: "string", default: "0" },
      "silent-files": { type: "string", default: String(CLASSIFICATION_SILENT_FILES_PER_PROJECT) },
      limit: { type: "string", default: String(CLASSIFICATION_LIMIT) },
      concurrency: { type: "string", default: String(CLASSIFICATION_CONCURRENCY) },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: nr mine [--output .fpfn] [--interval-minutes 60] [--silent-files 10]\n" +
        "               [--limit 1000] [--concurrency 8] [--rules contracts.json]\n" +
        "               -- <existing nr eval arguments>\n\n" +
        "Default: one FP-only Daytona scan → Jev classification → issues.ndjson.\n" +
        "Use --input run.ndjson to classify an existing scan instead of starting Daytona.\n" +
        "A positive interval repeats until interrupted. Each cycle keeps its scan and results.\n" +
        "The shared cache resumes model calls; issues.ndjson deduplicates candidate IDs.\n" +
        "Requires AI_GATEWAY_API_KEY and, for fresh scans, DAYTONA_API_KEY.\n",
    );
    return;
  }
  const intervalMinutes = z.coerce
    .number()
    .finite()
    .nonnegative()
    .parse(values["interval-minutes"]);
  z.coerce.number().int().positive().parse(values.limit);
  z.coerce.number().int().positive().parse(values.concurrency);
  z.coerce.number().int().nonnegative().parse(values["silent-files"]);
  if (!process.env.AI_GATEWAY_API_KEY || (!values.input && !process.env.DAYTONA_API_KEY)) {
    throw new Error("Set AI_GATEWAY_API_KEY and, for fresh scans, DAYTONA_API_KEY");
  }
  const directory = resolve(values.output);
  await mkdir(directory, { recursive: true });
  const issuesPath = join(directory, "issues.ndjson");
  const issues = await open(issuesPath, "a", EVALUATION_ARTIFACT_FILE_MODE);
  try {
    const logged = new Set<string>();
    for await (const record of readNdjson(issuesPath)) {
      logged.add(classificationResultSchema.parse(record).id);
    }
    do {
      const cycleDirectory = join(directory, `${Date.now()}-${randomUUID()}`);
      await mkdir(cycleDirectory);
      const scanPath = values.input ? resolve(values.input) : join(cycleDirectory, "scan.ndjson");
      const candidatesPath = join(cycleDirectory, "candidates.ndjson");
      const resultsPath = join(cycleDirectory, "results.ndjson");
      process.stderr.write(`FP/FN cycle: ${cycleDirectory}\n`);
      if (!values.input) {
        const scan = await open(scanPath, "wx", EVALUATION_ARTIFACT_FILE_MODE);
        try {
          const scanExitCode = await runStep("./cli.ts", evalArguments, scan.fd);
          process.stderr.write(`${JSON.stringify({ stage: "scan", exitCode: scanExitCode })}\n`);
          if (scanExitCode !== 0) process.exitCode = FAILURE_EXIT_CODE;
        } finally {
          await scan.close();
        }
      }
      const prepareExitCode = await runStep("./classification-cli.ts", [
        "prepare",
        "--input",
        scanPath,
        "--output",
        candidatesPath,
        "--skip-failed",
        "--silent-files",
        values["silent-files"],
        "--limit",
        values.limit,
        "--concurrency",
        values.concurrency,
        ...(values.rules ? ["--rules", values.rules] : []),
      ]);
      if (prepareExitCode !== 0)
        throw new Error(`Candidate preparation failed; inspect ${cycleDirectory}`);
      const classifyExitCode = await runStep("./classification-cli.ts", [
        "run",
        "--input",
        candidatesPath,
        "--output",
        resultsPath,
        "--cache",
        join(directory, "cache"),
        "--limit",
        values.limit,
        "--concurrency",
        values.concurrency,
      ]);
      let newIssues = 0;
      for await (const record of readNdjson(resultsPath)) {
        const result = classificationResultSchema.parse(record);
        if (
          (result.verdict === "candidate_fp" || result.verdict === "candidate_fn") &&
          !logged.has(result.id)
        ) {
          await issues.writeFile(serializeNdjsonRecord(result));
          logged.add(result.id);
          newIssues += 1;
        }
      }
      process.stderr.write(
        `${JSON.stringify({ stage: "classify", exitCode: classifyExitCode, newIssues, issuesPath })}\n`,
      );
      if (classifyExitCode !== 0) process.exitCode = FAILURE_EXIT_CODE;
      if (intervalMinutes > 0) await setTimeout(intervalMinutes * MILLISECONDS_PER_MINUTE);
    } while (intervalMinutes > 0);
  } finally {
    await issues.close();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${toErrorMessage(error)}\n`);
  process.exitCode = FAILURE_EXIT_CODE;
});
