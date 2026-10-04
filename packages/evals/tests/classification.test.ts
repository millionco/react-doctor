import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { assessmentSchema, classificationCandidateSchema } from "../src/classification-schema.js";
import type {
  ClassificationAssessment,
  ClassificationCandidate,
  ClassificationResult,
  RuleContract,
} from "../src/classification-schema.js";
import {
  CLASSIFICATION_MAX_CODE_CHARACTERS,
  CLASSIFICATION_TIMEOUT_MS,
  EVALUATION_CONFIG_CONTRACT,
} from "../src/constants.js";
import {
  loadPinnedClassificationSource,
  prepareClassificationCandidates,
} from "../src/prepare-classification.js";
import {
  classificationId,
  classifyAssessment,
  runClassification,
} from "../src/run-classification.js";
import { readNdjson } from "../src/utils/read-ndjson.js";

const rule: RuleContract = {
  key: "react-doctor/jsx-no-duplicate-props",
  description: "A JSX opening element must not repeat an explicit identifier attribute name.",
  exceptions: ["Names are case-sensitive.", "Ignore spread attributes and namespaced attributes."],
};

const buildCandidate = (): ClassificationCandidate => ({
  schemaVersion: 1,
  repository: { org: "owner", name: "repo", ref: "a".repeat(40), rootDir: "apps/web" },
  detectorCommit: "b".repeat(40),
  ruleSetHash: "c".repeat(64),
  rule,
  filePath: "apps/web/src/app.tsx",
  line: 1,
  detected: true,
  framework: "nextjs",
  code: 'export const App = () => <div id="a" id="b" />;',
  contextComplete: true,
});

const buildAssessment = (): ClassificationAssessment => ({
  choice: "violation",
  probabilities: { violation: 0.98, valid: 0.01, insufficient_context: 0.01 },
  contextSufficient: 0.99,
  inputTokens: 100,
});

const buildRecord = () => {
  const diagnostic = {
    id: "src/app.tsx::1:1::react-doctor/jsx-no-duplicate-props::digest",
    normalizedFilePath: "src/app.tsx",
    filePath: "src/app.tsx",
    plugin: "react-doctor",
    rule: "jsx-no-duplicate-props",
    severity: "warning",
    message: "Duplicate prop",
    help: "Remove duplicate prop.",
    category: "Correctness",
    line: 1,
    column: 1,
    tags: [],
  };
  return {
    schemaVersion: 1,
    repository: buildCandidate().repository,
    evaluation: {
      reactDoctorRepository: "https://github.com/millionco/react-doctor.git",
      reactDoctorCommit: "b".repeat(40),
      configContract: EVALUATION_CONFIG_CONTRACT,
      ruleSetHash: "c".repeat(64),
      ruleKeys: [rule.key],
    },
    report: {
      schemaVersion: 3,
      version: "0.8.1",
      ok: true,
      directory: "/workspace/target/apps/web",
      mode: "full",
      diff: null,
      projects: [
        {
          directory: "/workspace/target/apps/web",
          packageRoot: "/workspace/target/apps/web",
          framework: "nextjs",
          project: {},
          diagnostics: [diagnostic],
          score: null,
          skippedChecks: [],
          analyzedFiles: ["src/app.tsx", "src/clean.tsx", "src/other.tsx"],
          analyzedFileCount: 3,
          complete: true,
          elapsedMilliseconds: 1,
        },
      ],
      diagnostics: [diagnostic],
      summary: {
        errorCount: 0,
        warningCount: 1,
        affectedFileCount: 1,
        totalDiagnosticCount: 1,
        score: null,
        scoreLabel: null,
      },
      elapsedMilliseconds: 1,
      error: null,
    },
  };
};

const collect = async <Value>(iterable: AsyncIterable<Value>): Promise<Value[]> => {
  const values: Value[] = [];
  for await (const value of iterable) values.push(value);
  return values;
};

const asCandidates = async function* (candidates: ClassificationCandidate[]) {
  yield* candidates;
};

const execute = promisify(execFile);

const temporaryDirectories: string[] = [];
const createDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "react-doctor-classification-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("prepareClassificationCandidates", () => {
  const options = {
    rules: [rule],
    silentFilesPerProject: 2,
    loadSource: async () => buildCandidate().code,
  };

  it("combines pinned findings with silent analyzed files and normalizes nested roots", async () => {
    const record = buildRecord();
    record.report.projects[0].packageRoot += "/packages/ui";
    const candidates = await collect(prepareClassificationCandidates(record, options));
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toMatchObject({
      detected: true,
      filePath: "apps/web/packages/ui/src/app.tsx",
      line: 1,
      contextComplete: true,
      detectorCommit: record.evaluation.reactDoctorCommit,
    });
    expect(candidates.slice(1)).toEqual(
      expect.arrayContaining([expect.objectContaining({ detected: false, line: null })]),
    );
  });

  it("samples deterministically regardless of analyzed file order", async () => {
    const record = buildRecord();
    const samplingOptions = { ...options, silentFilesPerProject: 1 };
    const first = await collect(prepareClassificationCandidates(record, samplingOptions));
    record.report.projects[0].analyzedFiles.reverse();
    expect(await collect(prepareClassificationCandidates(record, samplingOptions))).toEqual(first);
  });

  it("keeps cache identity independent of sandbox checkout paths", async () => {
    const record = buildRecord();
    record.report.projects[0].project = { rootDirectory: record.report.directory };
    const first = await collect(prepareClassificationCandidates(record, options));
    record.report.directory = "/another/sandbox/web";
    record.report.projects[0].packageRoot = record.report.directory;
    record.report.projects[0].project = { rootDirectory: record.report.directory };
    const second = await collect(prepareClassificationCandidates(record, options));
    expect(second).toEqual(first);
    expect(second[0].project?.rootDirectory).toBe("apps/web");
  });

  it("rejects unpinned, incomplete, scoped-out, diff-only, and uncovered records", async () => {
    const unpinned = buildRecord();
    unpinned.repository.ref = "main";
    const incomplete = buildRecord();
    incomplete.report.projects[0].complete = false;
    const disabled = buildRecord();
    disabled.evaluation.ruleKeys = ["react-doctor/another-rule"];
    const diff = buildRecord();
    diff.report.mode = "diff";
    const uncovered = buildRecord();
    uncovered.report.projects[0].analyzedFiles[0] = "src/not-app.tsx";
    for (const record of [unpinned, incomplete, disabled, diff, uncovered]) {
      await expect(collect(prepareClassificationCandidates(record, options))).rejects.toThrow();
    }
  });

  it.each(["../../../../../secret", "/secret", "src\\secret", "src/\0secret"])(
    "rejects unsafe source path %s",
    async (filePath) => {
      const record = buildRecord();
      record.report.projects[0].analyzedFiles[0] = filePath;
      const loadSource = vi.fn(options.loadSource);
      await expect(
        collect(prepareClassificationCandidates(record, { ...options, loadSource })),
      ).rejects.toThrow();
      expect(loadSource).not.toHaveBeenCalled();
    },
  );

  it("marks missing, oversized, and invalid-line context for review without truncating", async () => {
    const record = buildRecord();
    record.report.projects[0].diagnostics[0].line = 500;
    const candidates = await collect(
      prepareClassificationCandidates(record, {
        ...options,
        loadSource: async (_repository, filePath) => {
          if (filePath.endsWith("clean.tsx")) throw new Error("not found");
          if (filePath.endsWith("other.tsx"))
            return "x".repeat(CLASSIFICATION_MAX_CODE_CHARACTERS + 1);
          return buildCandidate().code;
        },
      }),
    );
    expect(candidates.every((candidate) => !candidate.contextComplete)).toBe(true);
    expect(candidates.every((candidate) => candidate.contextIssue)).toBe(true);
    expect(candidates.find((candidate) => candidate.filePath.endsWith("other.tsx"))?.code).toBe("");
  });

  it("reuses source fetches and bounds download concurrency", async () => {
    let active = 0;
    let maximum = 0;
    const loadSource = vi.fn(async () => {
      active += 1;
      maximum = Math.max(active, maximum);
      await setImmediate();
      active -= 1;
      return buildCandidate().code;
    });
    const secondRule = { ...rule, key: "react-doctor/second-rule" };
    const record = buildRecord();
    record.evaluation.ruleKeys.push(secondRule.key);
    await collect(
      prepareClassificationCandidates(record, {
        ...options,
        rules: [rule, secondRule],
        concurrency: 2,
        loadSource,
      }),
    );
    expect(loadSource).toHaveBeenCalledTimes(3);
    expect(maximum).toBe(2);
  });

  it("fetches the exact revision and encodes path segments", async () => {
    const fetchSource = vi.fn(async () => new Response("source"));
    vi.stubGlobal("fetch", fetchSource);
    const repository = buildCandidate().repository;
    await expect(loadPinnedClassificationSource(repository, "src/a #.tsx")).resolves.toBe("source");
    expect(fetchSource).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/owner/repo/${repository.ref}/src/a%20%23.tsx`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("limits source downloads to the candidate budget", async () => {
    const loadSource = vi.fn(options.loadSource);
    const candidates = await collect(
      prepareClassificationCandidates(buildRecord(), {
        ...options,
        loadSource,
        limit: 1,
      }),
    );
    expect(candidates).toHaveLength(1);
    expect(loadSource).toHaveBeenCalledTimes(1);
  });
});

describe("classification", () => {
  it.each([
    [true, "violation", "likely_tp"],
    [false, "violation", "candidate_fn"],
    [true, "valid", "candidate_fp"],
    [false, "valid", "likely_tn"],
  ] as const)("maps detected=%s, %s to %s", (detected, choice, verdict) => {
    const probabilities = {
      violation: 0.01,
      valid: 0.01,
      insufficient_context: 0.01,
      [choice]: 0.98,
    };
    expect(
      classifyAssessment(
        { ...buildCandidate(), detected },
        { ...buildAssessment(), choice, probabilities },
        0.9,
      ),
    ).toBe(verdict);
  });

  it("abstains on uncertainty or missing context", () => {
    const candidate = buildCandidate();
    expect(
      classifyAssessment(candidate, { ...buildAssessment(), contextSufficient: 0.89 }, 0.9),
    ).toBe("review");
    expect(
      classifyAssessment({ ...candidate, contextComplete: false }, buildAssessment(), 0.9),
    ).toBe("review");
    expect(
      classifyAssessment(
        candidate,
        {
          ...buildAssessment(),
          probabilities: { violation: 0.89, valid: 0.1, insufficient_context: 0.01 },
        },
        0.9,
      ),
    ).toBe("review");
    expect(
      classifyAssessment(
        candidate,
        {
          ...buildAssessment(),
          choice: "insufficient_context",
          probabilities: { violation: 0, valid: 0, insufficient_context: 1 },
        },
        0.9,
      ),
    ).toBe("review");
  });

  it("rejects malformed answers and falsely complete context", () => {
    expect(
      assessmentSchema.safeParse({
        ...buildAssessment(),
        probabilities: { violation: 0.9, valid: 0.9, insufficient_context: 0.1 },
      }).success,
    ).toBe(false);
    expect(
      assessmentSchema.safeParse({ ...buildAssessment(), probabilities: undefined }).success,
    ).toBe(false);
    expect(classificationCandidateSchema.safeParse({ ...buildCandidate(), code: "" }).success).toBe(
      false,
    );
  });

  it("caches successful results, deduplicates candidates, and invalidates content/threshold changes", async () => {
    const directory = await createDirectory();
    const evaluate = vi.fn(async () => buildAssessment());
    const results: ClassificationResult[] = [];
    const options = {
      concurrency: 2,
      limit: 10,
      threshold: 0.9,
      cacheDirectory: directory,
      evaluate,
      write: async (result: ClassificationResult) => {
        results.push(result);
      },
    };
    const candidate = buildCandidate();
    const first = await runClassification(asCandidates([candidate, candidate]), options);
    expect(first).toMatchObject({ processed: 1, cached: 0, inputTokens: 100 });
    expect(await runClassification(asCandidates([candidate]), options)).toMatchObject({
      processed: 1,
      cached: 1,
      inputTokens: 0,
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
    const codeChange = { ...candidate, code: `${candidate.code}\n` };
    const ruleChange = { ...candidate, rule: { ...rule, exceptions: [] } };
    const revisionChange = { ...candidate, detectorCommit: "d".repeat(40) };
    await runClassification(asCandidates([codeChange, ruleChange, revisionChange]), options);
    await runClassification(asCandidates([candidate]), { ...options, threshold: 0.95 });
    expect(evaluate).toHaveBeenCalledTimes(5);
    expect(await readdir(directory)).toHaveLength(5);
    expect(results[0].verdict).toBe("likely_tp");
  });

  it("repairs corrupt caches and retries API errors on the next run", async () => {
    const directory = await createDirectory();
    const candidate = buildCandidate();
    const evaluate = vi.fn(async () => buildAssessment()).mockRejectedValueOnce(new Error("429"));
    const write = vi.fn(async (_result: ClassificationResult) => {});
    const options = {
      concurrency: 1,
      limit: 1,
      threshold: 0.9,
      cacheDirectory: directory,
      evaluate,
      write,
    };
    expect(await runClassification(asCandidates([candidate]), options)).toMatchObject({
      errors: 1,
    });
    expect(await readdir(directory)).toEqual([]);
    expect(write.mock.calls[0][0]).toMatchObject({ verdict: "error", error: "429" });
    const cachePath = join(directory, `${classificationId(candidate, 0.9)}.json`);
    await writeFile(cachePath, "{");
    expect(await runClassification(asCandidates([candidate]), options)).toMatchObject({
      errors: 0,
      cached: 0,
    });
    expect(JSON.parse(await readFile(cachePath, "utf8")).verdict).toBe("likely_tp");
  });

  it("skips Jev for incomplete context and respects concurrency and total limits", async () => {
    const directory = await createDirectory();
    let active = 0;
    let maximum = 0;
    let releaseOverlappingCalls = () => {};
    const overlappingCalls = new Promise<void>((resolve) => {
      releaseOverlappingCalls = resolve;
    });
    const evaluate = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      if (active === 2) releaseOverlappingCalls();
      await overlappingCalls;
      active -= 1;
      return buildAssessment();
    });
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      ...buildCandidate(),
      filePath: `src/${index}.tsx`,
    }));
    const summary = await runClassification(asCandidates(candidates), {
      concurrency: 2,
      limit: 5,
      threshold: 0.9,
      cacheDirectory: directory,
      evaluate,
      write: async () => {},
    });
    expect(summary).toMatchObject({ processed: 5, cached: 0 });
    expect(evaluate).toHaveBeenCalledTimes(5);
    expect(maximum).toBe(2);
    expect(summary.byRule[rule.key]).toEqual({ likely_tp: 5 });
    const incomplete = { ...buildCandidate(), contextComplete: false };
    const write = vi.fn(async (_result: ClassificationResult) => {});
    await runClassification(asCandidates([incomplete]), {
      concurrency: 1,
      limit: 1,
      threshold: 0.9,
      cacheDirectory: directory,
      evaluate,
      write,
    });
    expect(evaluate).toHaveBeenCalledTimes(5);
    expect(write.mock.calls[0][0]).toMatchObject({ verdict: "review", assessment: null });
  });

  it("reads NDJSON with line-number errors and propagates missing input failures", async () => {
    const directory = await createDirectory();
    const filePath = join(directory, "input.ndjson");
    await writeFile(filePath, '\n{"value":1}\nnot json');
    await expect(collect(readNdjson(filePath))).rejects.toThrow(`${filePath}:3: invalid JSON`);
    await expect(collect(readNdjson(join(directory, "missing")))).rejects.toThrow("ENOENT");
  });
});

describe("mining CLI", () => {
  it(
    "runs the preparation and real SDK path, then resumes without duplicate issue logs",
    async () => {
      const directory = await createDirectory();
      const inputPath = join(directory, "scan.ndjson");
      const contractsPath = join(directory, "contracts.json");
      const preloadPath = join(directory, "mock-fetch.mjs");
      const requestsPath = join(directory, "requests.ndjson");
      const outputDirectory = join(directory, "output");
      await writeFile(inputPath, `${JSON.stringify(buildRecord())}\n`);
      await writeFile(contractsPath, JSON.stringify([rule]));
      await writeFile(
        preloadPath,
        `
      import { appendFile } from "node:fs/promises";
      globalThis.fetch = async (url, options) => {
        if (String(url).startsWith("https://raw.githubusercontent.com/")) {
          return new Response('export const App = () => <div id="unique" />;');
        }
        if (String(url) !== "https://ai-gateway.vercel.sh/v4/ai/evaluation-model") {
          throw new Error("Unexpected network call: " + url);
        }
        await appendFile(${JSON.stringify(requestsPath)}, options.body + "\\n");
        return Response.json({
          answers: {
            assessment: { type: "choice", choice: "valid",
              probabilities: { valid: 0.98, violation: 0.01, insufficient_context: 0.01 } },
            contextSufficient: { type: "boolean", probability: 0.99 },
          },
          usage: { inputTokens: 123 },
        });
      };
    `,
      );
      const argumentsList = [
        "--import",
        "tsx",
        "src/classification-mining-cli.ts",
        "--input",
        inputPath,
        "--rules",
        contractsPath,
        "--output",
        outputDirectory,
      ];
      const options = {
        cwd: fileURLToPath(new URL("..", import.meta.url)),
        env: {
          ...process.env,
          AI_GATEWAY_API_KEY: "fixture-only",
          NODE_OPTIONS: `--import ${pathToFileURL(preloadPath).href}`,
        },
      };
      const first = await execute(process.execPath, argumentsList, options);
      expect(first.stderr).toContain('"newIssues":1');
      const second = await execute(process.execPath, argumentsList, options);
      expect(second.stderr).toContain('"cached":1');
      expect(second.stderr).toContain('"newIssues":0');
      const issues = await collect(readNdjson(join(outputDirectory, "issues.ndjson")));
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        verdict: "candidate_fp",
        assessment: { inputTokens: 123 },
      });
      expect(await collect(readNdjson(requestsPath))).toHaveLength(1);
    },
    CLASSIFICATION_TIMEOUT_MS,
  );
});
