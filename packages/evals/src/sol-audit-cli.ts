import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { classificationResultSchema } from "./classification-schema.js";
import type {
  ClassificationCandidate,
  ClassificationResult,
  RuleContract,
} from "./classification-schema.js";
import {
  CLASSIFICATION_CONCURRENCY,
  CLASSIFICATION_THRESHOLD,
  EVALUATION_ARTIFACT_FILE_MODE,
  SOL_REVIEW_CASES_PER_POPULATION,
  SOL_REVIEW_CONCURRENCY,
  SOL_REVIEW_MODEL,
  SOL_REVIEW_PROMPT_VERSION,
  SOL_REVIEW_CHALLENGE_VERSION,
} from "./constants.js";
import { loadClassificationRules } from "./load-classification-rules.js";
import { loadClassificationContext } from "./load-classification-context.js";
import {
  loadPinnedClassificationSource,
  prepareClassificationCandidates,
} from "./prepare-classification.js";
import { selectClassification } from "./select-classification.js";
import { evaluateWithJev } from "./jev-classifier.js";
import { runClassification } from "./run-classification.js";
import { reviewWithSol } from "./review-with-sol.js";
import { readNdjson } from "./utils/read-ndjson.js";
import { createConcurrencyLimit } from "./utils/create-concurrency-limit.js";
import { serializeNdjsonRecord } from "./utils/serialize-ndjson-record.js";
import { classificationErrorEvidence } from "./classification-response-error.js";
import { renderSolAudit } from "./render-sol-audit.js";
import type { SolReview } from "./sol-review-schema.js";
import { loadSolReviewCache } from "./utils/load-sol-review-cache.js";
import { finalizeSolReview } from "./utils/finalize-sol-review.js";
import { getClassificationCost } from "./utils/get-classification-cost.js";
import { getEvaluatorSourceHash } from "./utils/get-evaluator-source-hash.js";

interface AuditRepository {
  org: string;
  name: string;
  ref: string;
  rootDir: string;
}

interface AuditCoverage {
  repository: AuditRepository;
  status: string;
  selected: number;
  populations: Array<{ detected: boolean; eligible: number; selected: number }>;
}

interface SolReviewCall {
  id: string;
  stage: string;
  cached: boolean;
  costUsd: number | null;
  inputTokens: number;
  outputTokens: number;
}

const recordSchema = z.looseObject({
  repository: z.object({
    org: z.string(),
    name: z.string(),
    ref: z.string(),
    rootDir: z.string(),
  }),
  error: z.string().optional(),
});

const main = async (): Promise<void> => {
  const reviewerSourceHash = getEvaluatorSourceHash();
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      corpus: { type: "string" },
      output: { type: "string" },
      repositories: { type: "string", default: "10" },
      cache: { type: "string" },
    },
  });
  if (!values.input || !values.corpus || !values.output || !values.cache)
    throw new Error(
      "Required: --input scan.ndjson --corpus corpus.json --output directory --cache directory",
    );
  const repositoryCount = z.coerce.number().int().positive().parse(values.repositories);
  const corpus = z
    .array(recordSchema.shape.repository)
    .parse(JSON.parse(await readFile(values.corpus, "utf8")))
    .slice(0, repositoryCount);
  if (corpus.length !== repositoryCount)
    throw new Error("Corpus is smaller than requested denominator");
  const directory = resolve(values.output);
  await mkdir(directory, { recursive: true });
  await mkdir(values.cache, { recursive: true });
  const save = async (name: string, value: unknown): Promise<void> =>
    writeFile(join(directory, name), JSON.stringify(value, null, 2), {
      mode: EVALUATION_ARTIFACT_FILE_MODE,
    });
  const records = new Map<string, unknown>();
  const requestedRepositories = new Set(corpus.map((repository) => JSON.stringify(repository)));
  for await (const record of readNdjson(values.input)) {
    const parsed = recordSchema.parse(record);
    if (requestedRepositories.has(JSON.stringify(parsed.repository)))
      records.set(JSON.stringify(parsed.repository), record);
  }
  const coverage: AuditCoverage[] = [];
  const candidates: ClassificationCandidate[] = [];
  const catalogCache = new Map<string, RuleContract[]>();
  const sourceCache = new Map<string, Promise<string>>();
  const loadSource = (repository: AuditRepository, path: string): Promise<string> => {
    const identity = JSON.stringify([repository, path]);
    let source = sourceCache.get(identity);
    if (!source) {
      source = loadPinnedClassificationSource(repository, path);
      sourceCache.set(identity, source);
    }
    return source;
  };
  const contextLimit = createConcurrencyLimit(CLASSIFICATION_CONCURRENCY);
  for (const repository of corpus) {
    const record = records.get(JSON.stringify(repository));
    records.delete(JSON.stringify(repository));
    const entry: AuditCoverage = { repository, status: "missing", selected: 0, populations: [] };
    coverage.push(entry);
    if (!record) continue;
    if (recordSchema.parse(record).error) {
      entry.status = "scan_error";
      continue;
    }
    try {
      const rules = await loadClassificationRules(record, catalogCache);
      for (const detected of [true, false]) {
        const readGroups = async function* () {
          for await (const candidate of prepareClassificationCandidates(record, {
            rules,
            silentFilesPerProject: SOL_REVIEW_CASES_PER_POPULATION,
            loadSource,
            metadataOnly: true,
            groupOccurrences: true,
            population: "default",
          })) {
            if (candidate.detected === detected) yield candidate;
          }
        };
        const selection = await selectClassification(readGroups, SOL_REVIEW_CASES_PER_POPULATION);
        candidates.push(
          ...(await Promise.all(
            selection.candidates.map((candidate) =>
              contextLimit(() => loadClassificationContext(candidate, loadSource)),
            ),
          )),
        );
        entry.populations.push({
          detected,
          eligible: selection.coverage.eligibleGroups,
          selected: selection.candidates.length,
        });
        entry.selected += selection.candidates.length;
      }
      entry.status = "scanned";
    } catch (error) {
      entry.status = "preparation_error";
      await save(
        `preparation-error-${repository.org}-${repository.name}.json`,
        classificationErrorEvidence(error),
      );
    }
    process.stderr.write(
      `Prepared ${coverage.length}/${corpus.length} repositories (${candidates.length} cases)\n`,
    );
    await save("coverage.json", coverage);
    sourceCache.clear();
  }
  await save("coverage.json", coverage);
  await save("manifest.json", {
    reviewerSourceHash,
    repositoryCount,
    casesPerPopulation: SOL_REVIEW_CASES_PER_POPULATION,
    model: SOL_REVIEW_MODEL,
    promptVersion: SOL_REVIEW_PROMPT_VERSION,
    scanSha256: createHash("sha256")
      .update(await readFile(values.input))
      .digest("hex"),
    corpus,
  });
  await writeFile(
    join(directory, "candidates.ndjson"),
    candidates.map(serializeNdjsonRecord).join(""),
    { mode: EVALUATION_ARTIFACT_FILE_MODE },
  );
  const screenings: ClassificationResult[] = [];
  await writeFile(join(directory, "jev.ndjson"), "", { mode: EVALUATION_ARTIFACT_FILE_MODE });
  const screeningSummary = await runClassification(
    readNdjson(join(directory, "candidates.ndjson")),
    {
      concurrency: SOL_REVIEW_CONCURRENCY,
      limit: Math.max(1, candidates.length),
      threshold: CLASSIFICATION_THRESHOLD,
      cacheDirectory: join(values.cache, "jev"),
      evaluate: evaluateWithJev,
      write: async (result) => {
        screenings.push(result);
        await appendFile(join(directory, "jev.ndjson"), serializeNdjsonRecord(result), {
          mode: EVALUATION_ARTIFACT_FILE_MODE,
        });
        process.stderr.write(`Jev ${screenings.length}/${candidates.length}: ${result.verdict}\n`);
      },
    },
  );
  await save("jev-summary.json", screeningSummary);
  const reviews: SolReview[] = [];
  const reviewCalls: SolReviewCall[] = [];
  const errors: Array<{ id: string; evidence: unknown }> = [];
  const queued = screenings.filter(
    (screening) =>
      screening.verdict !== "error" &&
      (screening.verdict === "review" ||
        screening.verdict === "candidate_fp" ||
        screening.verdict === "candidate_fn"),
  );
  const reviewLimit = createConcurrencyLimit(SOL_REVIEW_CONCURRENCY);
  let cachedReviews = 0;
  await Promise.all(
    queued.map((screening) =>
      reviewLimit(async () => {
        try {
          classificationResultSchema.parse(screening);
          const cachePath = join(
            values.cache!,
            `sol-${SOL_REVIEW_PROMPT_VERSION}-${screening.id}.json`,
          );
          const cachedReview = await loadSolReviewCache(cachePath, screening);
          let review = finalizeSolReview(
            cachedReview ?? (await reviewWithSol(screening)),
            screening.candidate,
          );
          cachedReviews += Number(Boolean(cachedReview));
          reviewCalls.push({
            id: review.id,
            stage: "independent",
            cached: Boolean(cachedReview),
            costUsd: review.costUsd ?? getClassificationCost(review.provenance),
            inputTokens: review.inputTokens,
            outputTokens: review.outputTokens,
          });
          if (!cachedReview)
            await writeFile(cachePath, JSON.stringify(review), {
              mode: EVALUATION_ARTIFACT_FILE_MODE,
            });
          if (review.verdict === "fp" || review.verdict === "fn") {
            await save(`initial-sol-${review.id}.json`, review);
            const challengePath = join(
              values.cache!,
              `sol-${SOL_REVIEW_CHALLENGE_VERSION}-${screening.id}.json`,
            );
            const cachedChallenge = await loadSolReviewCache(
              challengePath,
              screening,
              SOL_REVIEW_CHALLENGE_VERSION,
            );
            review = finalizeSolReview(
              cachedChallenge ?? (await reviewWithSol(screening, review)),
              screening.candidate,
            );
            if (!cachedChallenge)
              await writeFile(challengePath, JSON.stringify(review), {
                mode: EVALUATION_ARTIFACT_FILE_MODE,
              });
            cachedReviews += Number(Boolean(cachedChallenge));
            reviewCalls.push({
              id: review.id,
              stage: "challenge",
              cached: Boolean(cachedChallenge),
              costUsd: review.costUsd ?? getClassificationCost(review.provenance),
              inputTokens: review.inputTokens,
              outputTokens: review.outputTokens,
            });
          }
          reviews.push(review);
          await save(`sol-${review.id}.json`, review);
          process.stderr.write(
            `Sol ${reviews.length + errors.length}/${queued.length}: ${review.verdict}\n`,
          );
        } catch (error) {
          const failure = { id: screening.id, evidence: classificationErrorEvidence(error) };
          errors.push(failure);
          await save(`sol-error-${screening.id}.json`, failure);
          process.stderr.write(`Sol ${reviews.length + errors.length}/${queued.length}: error\n`);
        }
      }),
    ),
  );
  const citationErrors = reviews.reduce((count, review) => count + review.citationIssues.length, 0);
  const passed =
    coverage.every((entry) => entry.status === "scanned") &&
    screeningSummary.errors === 0 &&
    errors.length === 0 &&
    citationErrors === 0 &&
    reviews.length > 0;
  const summary = {
    passed,
    repositoryCount,
    scanned: coverage.filter((entry) => entry.status === "scanned").length,
    candidates: candidates.length,
    screening: screeningSummary,
    reviewed: reviews.length,
    cachedReviews,
    errors: errors.length,
    citationErrors,
    verdicts: Object.fromEntries(
      ["fp", "fn", "rejected", "unresolved"].map((verdict) => [
        verdict,
        reviews.filter((review) => review.verdict === verdict).length,
      ]),
    ),
    solInputTokens: reviewCalls.reduce((count, call) => count + call.inputTokens, 0),
    solOutputTokens: reviewCalls.reduce((count, call) => count + call.outputTokens, 0),
    costs: {
      jevEvidenceUsd: screenings.reduce(
        (total, screening) =>
          total + (getClassificationCost(screening.assessment?.provenance) ?? 0),
        0,
      ),
      solEvidenceUsd: reviewCalls.reduce((total, call) => total + (call.costUsd ?? 0), 0),
      solNewCallsUsd: reviewCalls
        .filter((call) => !call.cached)
        .reduce((total, call) => total + (call.costUsd ?? 0), 0),
      missingSolCostRecords: reviewCalls.filter((call) => call.costUsd === null).length,
    },
  };
  await save("review-calls.json", reviewCalls);
  await save("summary.json", summary);
  await writeFile(join(directory, "report.md"), renderSolAudit(screenings, reviews, summary), {
    mode: EVALUATION_ARTIFACT_FILE_MODE,
  });
  process.stderr.write(`${JSON.stringify(summary)}\n`);
  if (!passed) process.exitCode = 1;
};

main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify(classificationErrorEvidence(error))}\n`);
  process.exitCode = 1;
});
