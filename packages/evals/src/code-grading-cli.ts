import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { z } from "zod";

import { assessmentSchema } from "./classification-schema.js";
import { codeGradingBatchSchema } from "./code-grading-schema.js";
import { createCodeGradingCache } from "./utils/create-code-grading-cache.js";
import type { CodeGradingCacheRecord } from "./utils/create-code-grading-cache.js";
import { EVALUATION_ARTIFACT_FILE_MODE, CODE_GRADING_MAX_CACHE_ENTRIES } from "./constants.js";
import { gradeCodeBatch } from "./grade-code-batch.js";

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    output: { type: "string" },
    cache: { type: "string" },
    offline: { type: "boolean", default: false },
  },
});
if (!values.input || !values.output) {
  throw new Error(
    "Usage: nr grade --input batch.json --output grades.json [--cache cache.json] [--offline]",
  );
}

const batch = codeGradingBatchSchema.parse(JSON.parse(await readFile(values.input, "utf8")));
let cacheRecords: CodeGradingCacheRecord[] = [];
if (values.cache) {
  try {
    cacheRecords = z
      .array(
        z.object({
          id: z.string().regex(/^[0-9a-f]{64}$/),
          assessment: assessmentSchema,
          expiresAt: z.number().finite(),
        }),
      )
      .max(CODE_GRADING_MAX_CACHE_ENTRIES)
      .parse(JSON.parse(await readFile(values.cache, "utf8")));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
}

const cache = createCodeGradingCache({ records: cacheRecords });
const result = await gradeCodeBatch(
  { ...batch, mode: values.offline ? "offline" : batch.mode },
  { cache },
);
await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`, {
  mode: EVALUATION_ARTIFACT_FILE_MODE,
});
if (values.cache) {
  const temporaryPath = `${values.cache}.${randomUUID()}.partial`;
  try {
    await writeFile(temporaryPath, JSON.stringify(cache.snapshot()), {
      flag: "wx",
      mode: EVALUATION_ARTIFACT_FILE_MODE,
    });
    await rename(temporaryPath, values.cache);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
process.stdout.write(`${JSON.stringify(result.summary)}\n`);
