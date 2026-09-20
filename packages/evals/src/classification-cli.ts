import { createHash } from "node:crypto";
import { readFile, open, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { z } from "zod";

import { classificationCandidateSchema, ruleContractSchema } from "./classification-schema.js";
import {
  CLASSIFICATION_CONCURRENCY,
  CLASSIFICATION_LIMIT,
  CLASSIFICATION_SILENT_FILES_PER_PROJECT,
  CLASSIFICATION_THRESHOLD,
  FAILURE_EXIT_CODE,
  EVALUATION_ARTIFACT_FILE_MODE,
} from "./constants.js";
import { evaluateWithJev } from "./jev-classifier.js";
import { loadClassificationRules } from "./load-classification-rules.js";
import type { RuleContract } from "./classification-schema.js";
import {
  loadPinnedClassificationSource,
  prepareClassificationCandidates,
} from "./prepare-classification.js";
import { runClassification } from "./run-classification.js";
import { readNdjson } from "./utils/read-ndjson.js";
import { serializeNdjsonRecord } from "./utils/serialize-ndjson-record.js";
import { toErrorMessage } from "./utils/to-error-message.js";
import { selectClassification } from "./select-classification.js";
import { loadClassificationContext } from "./load-classification-context.js";

const main = async (): Promise<void> => {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      input: { type: "string" },
      output: { type: "string" },
      rules: { type: "string" },
      rule: { type: "string", multiple: true },
      population: { type: "string", default: "default" },
      "skip-failed": { type: "boolean", default: false },
      cache: { type: "string", default: ".classification-cache" },
      concurrency: { type: "string", default: String(CLASSIFICATION_CONCURRENCY) },
      limit: { type: "string", default: String(CLASSIFICATION_LIMIT) },
      threshold: { type: "string", default: String(CLASSIFICATION_THRESHOLD) },
      "silent-files": { type: "string", default: String(CLASSIFICATION_SILENT_FILES_PER_PROJECT) },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Usage:\n" +
        "  nr classify prepare --input run.ndjson --output candidates.ndjson [--rules contracts.json]\n" +
        "  nr classify run --input candidates.ndjson --output results.ndjson [--dry-run]\n\n" +
        "Options: --limit 1000, --concurrency 8, --threshold 0.9, --cache .classification-cache\n" +
        "Prepare uses pinned rule descriptions automatically; --rule plugin/rule filters them.\n" +
        "Prepare: --population default selects default-enabled rules; exhaustive includes optional policies.\n" +
        "Selection balances repositories, rules and files across all input records; writes OUTPUT.selection.json.\n" +
        "Prepare: --silent-files 0 (FP only); set 10 for FN sampling per project and rule.\n" +
        "Prepare: --skip-failed skips failed scans, logging their count to stderr.\n" +
        "Run requires AI_GATEWAY_API_KEY. Outputs are created exclusively; reuse --cache to resume.\n" +
        "Verdicts are triage candidates, not confirmed bugs. See README for the input contract.\n",
    );
    return;
  }
  const command = positionals[0];
  if (
    positionals.length !== 1 ||
    (command !== "prepare" && command !== "run") ||
    !values.input ||
    !values.output
  ) {
    throw new Error("Expected prepare or run with --input and --output; use --help");
  }
  const limit = z.coerce.number().int().positive().parse(values.limit);
  const concurrency = z.coerce.number().int().positive().parse(values.concurrency);
  const threshold = z.coerce.number().gt(0.5).max(1).parse(values.threshold);
  const silentFiles = z.coerce.number().int().nonnegative().parse(values["silent-files"]);
  const population = z.enum(["default", "exhaustive"]).parse(values.population);
  const requestedRules = values.rule ? new Set(values.rule) : null;
  const rules =
    command === "prepare" && values.rules
      ? z
          .array(ruleContractSchema)
          .nonempty()
          .parse(JSON.parse(await readFile(values.rules, "utf8")))
      : [];
  if (new Set(rules.map((rule) => rule.key)).size !== rules.length) {
    throw new Error("Rule contracts must have unique keys");
  }
  if (command === "run" && !values["dry-run"] && !process.env.AI_GATEWAY_API_KEY) {
    throw new Error("Set AI_GATEWAY_API_KEY, or use --dry-run to validate without model calls");
  }
  if (command === "prepare" && values["dry-run"]) {
    throw new Error("--dry-run is only supported by run");
  }
  const output = await open(values.output, "wx", EVALUATION_ARTIFACT_FILE_MODE);
  try {
    if (command === "prepare") {
      let prepared = 0;
      let incomplete = 0;
      let skipped = 0;
      const catalogCache = new Map<string, RuleContract[]>();
      const inputPath = values.input;
      let pass = 0;
      const readGroups = async function* () {
        const scans = new Map<string, string>();
        pass += 1;
        for await (const record of readNdjson(inputPath)) {
          const failed = z.object({ error: z.string() }).safeParse(record);
          if (values["skip-failed"] && failed.success) {
            if (pass === 1) skipped += 1;
            continue;
          }
          const identity = z.object({ repository: z.json(), evaluation: z.json() }).parse(record);
          const scanKey = JSON.stringify(identity);
          const scanHash = createHash("sha256").update(JSON.stringify(record)).digest("hex");
          if (scans.has(scanKey)) {
            if (scans.get(scanKey) !== scanHash)
              throw new Error("Conflicting duplicate scan records");
            continue;
          }
          scans.set(scanKey, scanHash);
          const availableRules = values.rules
            ? rules
            : await loadClassificationRules(record, catalogCache);
          const selectedRules = requestedRules
            ? availableRules.filter((rule) => requestedRules.has(rule.key))
            : availableRules;
          if (values.rule?.some((key) => !availableRules.some((rule) => rule.key === key))) {
            throw new Error("A selected --rule is absent from this evaluation's rule catalog");
          }
          if (
            !values.rules &&
            requestedRules &&
            population === "default" &&
            selectedRules.some((rule) => !rule.defaultEnabled)
          ) {
            throw new Error(
              "A selected --rule is optional; use --population exhaustive to include it",
            );
          }
          yield* prepareClassificationCandidates(record, {
            rules: selectedRules,
            concurrency,
            silentFilesPerProject: silentFiles,
            loadSource: loadPinnedClassificationSource,
            metadataOnly: true,
            groupOccurrences: true,
            population: values.rules ? "explicit-contract" : population,
          });
        }
      };
      const selection = await selectClassification(readGroups, limit);
      for (let offset = 0; offset < selection.candidates.length; offset += concurrency) {
        const batch = await Promise.all(
          selection.candidates
            .slice(offset, offset + concurrency)
            .map((candidate) =>
              loadClassificationContext(candidate, loadPinnedClassificationSource),
            ),
        );
        for (const candidate of batch) {
          await output.writeFile(serializeNdjsonRecord(candidate));
          prepared += 1;
          incomplete += Number(!candidate.contextComplete);
        }
      }
      const summary = {
        prepared,
        incomplete,
        skipped,
        population: values.rules ? "explicit-contract" : population,
        coverage: selection.coverage,
      };
      await writeFile(`${values.output}.selection.json`, JSON.stringify(summary), {
        flag: "wx",
        mode: EVALUATION_ARTIFACT_FILE_MODE,
      });
      process.stderr.write(`${JSON.stringify(summary)}\n`);
      return;
    }
    if (values["dry-run"]) {
      let candidates = 0;
      for await (const value of readNdjson(values.input)) {
        const candidate = classificationCandidateSchema.parse(value);
        await output.writeFile(serializeNdjsonRecord(candidate));
        candidates += 1;
        if (candidates >= limit) break;
      }
      process.stderr.write(`${JSON.stringify({ dryRun: true, candidates })}\n`);
      return;
    }
    const summary = await runClassification(readNdjson(values.input), {
      concurrency,
      limit,
      threshold,
      cacheDirectory: values.cache,
      evaluate: evaluateWithJev,
      write: async (result, cached) =>
        output.writeFile(serializeNdjsonRecord({ ...result, cached })),
    });
    process.stderr.write(`${JSON.stringify(summary)}\n`);
    if (summary.errors > 0) process.exitCode = FAILURE_EXIT_CODE;
  } finally {
    await output.close();
  }
};

main().catch((error: unknown) => {
  process.stderr.write(`${toErrorMessage(error)}\n`);
  process.exitCode = FAILURE_EXIT_CODE;
});
