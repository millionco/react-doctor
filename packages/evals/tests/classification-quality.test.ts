import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { auditClassification } from "../src/audit-classification.js";
import { classificationCandidateSchema } from "../src/classification-schema.js";
import type {
  ClassificationAssessment,
  ClassificationCandidate,
  ClassificationResult,
} from "../src/classification-schema.js";
import { CLASSIFICATION_MAX_CODE_CHARACTERS } from "../src/constants.js";
import { loadClassificationContext } from "../src/load-classification-context.js";
import {
  loadPinnedClassificationSource,
  PinnedSourceLimitError,
  PinnedSourceMissingError,
} from "../src/prepare-classification.js";
import { classificationAssessmentId, runClassification } from "../src/run-classification.js";
import { getClassificationApplicability } from "../src/utils/get-classification-applicability.js";

const candidate: ClassificationCandidate = {
  schemaVersion: 2,
  repository: { org: "owner", name: "repo", ref: "a".repeat(40), rootDir: "." },
  detectorCommit: "b".repeat(40),
  ruleSetHash: "c".repeat(64),
  rule: {
    key: "react-doctor/jsx-no-duplicate-props",
    description: "No duplicate JSX attributes.",
    exceptions: [],
  },
  filePath: "app.tsx",
  line: 1,
  detected: true,
  framework: "unknown",
  code: 'const App = () => <div id="a" id="b" />;',
  contextComplete: true,
};
const assessment: ClassificationAssessment = {
  choice: "violation",
  probabilities: { violation: 0.98, valid: 0.01, insufficient_context: 0.01 },
  contextSufficient: 0.98,
  inputTokens: 10,
};
const iterate = async function* (values: unknown[]) {
  yield* values;
};
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const classify = async (
  candidates: ClassificationCandidate[],
  responses: ClassificationAssessment[],
) => {
  const directory = await mkdtemp(join(tmpdir(), "jev-quality-"));
  directories.push(directory);
  const results: ClassificationResult[] = [];
  let index = 0;
  const evaluate = vi.fn(async () => responses[index++]);
  const options = {
    concurrency: 1,
    limit: candidates.length,
    threshold: 0.9,
    cacheDirectory: directory,
    evaluate,
    write: async (result: ClassificationResult) => {
      results.push(result);
    },
  };
  const summary = await runClassification(iterate(candidates), options);
  return { results, summary, options, evaluate };
};

describe("classification applicability", () => {
  const check = (
    requires: string[],
    project: Record<string, unknown>,
    disabledWhen: string[] = [],
  ) =>
    getClassificationApplicability({
      rule: { ...candidate.rule, applicability: { requires, disabledWhen } },
      framework: "vite",
      project,
    });
  it("excludes known absent capabilities, including versioned requirements", () => {
    expect(check(["three:181"], { hasThree: false, hasReactThreeFiber: false })).toEqual({
      status: "inapplicable",
      reasons: ["Required capability absent: three:181"],
    });
    expect(check(["three"], { hasThree: false, hasReactThreeFiber: true }).status).toBe(
      "applicable",
    );
  });
  it("does not turn missing metadata or unsupported versions into negative evidence", () => {
    expect(check(["three"], { hasThree: false }).status).toBe("unknown");
    expect(check(["three:181"], { hasThree: true }).status).toBe("unknown");
    expect(check(["future-capability"], {}).status).toBe("unknown");
  });
  it("keeps unresolved Ink version gates explicit", () => {
    expect(
      getClassificationApplicability({
        rule: { ...candidate.rule, applicability: { minimumInkVersion: "6.0.0" } },
        framework: "unknown",
        project: {},
      }),
    ).toEqual({ status: "unknown", reasons: ["Minimum Ink version unresolved"] });
  });
  it("honors known disabling gates without assuming unknown ones are present", () => {
    expect(check([], { hasReactCompiler: true }, ["react-compiler"]).status).toBe("inapplicable");
    expect(check([], { hasReactThreeFiber: true }, ["r3f:10"]).status).toBe("unknown");
    expect(check([], { hasReactCompiler: false }, ["react-compiler"]).status).toBe("applicable");
  });
});

describe("source evidence failures", () => {
  it("rejects complete context that also reports an unresolved issue", () => {
    expect(
      classificationCandidateSchema.safeParse({ ...candidate, contextIssue: "Missing evidence" })
        .success,
    ).toBe(false);
  });
  it.each([
    [new PinnedSourceLimitError(), "Source exceeds the classification context limit"],
    [new PinnedSourceMissingError(), "Pinned source is absent"],
    [new Error("network error with private details"), "Pinned source is unavailable"],
  ])("keeps safe and precise source failure reasons", async (error, issue) => {
    const result = await loadClassificationContext(candidate, async () => {
      throw error;
    });
    expect(result).toMatchObject({ contextComplete: false, code: "", contextIssue: issue });
  });
  it("stops a streamed oversized response with a typed limit failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(CLASSIFICATION_MAX_CODE_CHARACTERS + 1))),
    );
    await expect(
      loadPinnedClassificationSource(candidate.repository, candidate.filePath),
    ).rejects.toBeInstanceOf(PinnedSourceLimitError);
  });
});

describe("classification review accounting and calibration", () => {
  it("reports all failed gates and replays cached assessments without new calls", async () => {
    const low = {
      ...assessment,
      probabilities: { violation: 0.8, valid: 0.1, insufficient_context: 0.1 },
      contextSufficient: 0.7,
    };
    const { results, summary, options, evaluate } = await classify([candidate], [low]);
    expect(results[0].reviewReasons).toEqual([
      "context_confidence_below_threshold",
      "choice_confidence_below_threshold",
    ]);
    expect(summary).toMatchObject({
      modelCalls: 1,
      skipped: 0,
      byReviewReason: {
        context_confidence_below_threshold: 1,
        choice_confidence_below_threshold: 1,
      },
    });
    const replay = await runClassification(iterate([candidate]), options);
    expect(replay).toMatchObject({ cached: 1, modelCalls: 0, inputTokens: 0 });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
  it("counts skipped source separately from successful model calls", async () => {
    const { results, summary, evaluate } = await classify(
      [
        {
          ...candidate,
          contextComplete: false,
          code: "",
          contextIssue: "Source exceeds the classification context limit",
        },
      ],
      [],
    );
    expect(summary).toMatchObject({
      modelCalls: 0,
      skipped: 1,
      byReviewReason: { incomplete_context: 1 },
    });
    expect(evaluate).not.toHaveBeenCalled();
    expect(results[0].verdict).toBe("review");
  });
  it("keeps abstentions in the denominator and identifies confidently wrong answers", async () => {
    const cases = [
      candidate,
      { ...candidate, filePath: "wrong.tsx" },
      { ...candidate, filePath: "uncertain.tsx" },
    ];
    const { results } = await classify(cases, [
      assessment,
      assessment,
      { ...assessment, contextSufficient: 0.5 },
    ]);
    const labels = cases.map((item, index) => ({
      assessmentId: classificationAssessmentId(item),
      expected: index === 1 ? "valid" : "violation",
      rationale: "Independent source review",
    }));
    await expect(
      auditClassification(
        iterate(
          results.map((result, index) =>
            index === 2 ? { ...result, verdict: "likely_tp" } : result,
          ),
        ),
        labels,
      ),
    ).rejects.toThrow("confidence policy");
    const report = await auditClassification(iterate(results), labels);
    expect(report).toMatchObject({
      labeled: 3,
      assessed: 3,
      accepted: 2,
      review: 1,
      acceptedCorrect: 1,
      acceptedIncorrect: 1,
      rawCorrect: 2,
      decisionCoverage: 2 / 3,
      acceptedAccuracy: 0.5,
    });
    await expect(auditClassification(iterate(results.slice(1)), labels)).rejects.toThrow(
      "every label",
    );
    await expect(auditClassification(iterate(results), labels.slice(1))).rejects.toThrow(
      "no independent label",
    );
    await expect(auditClassification(iterate([...results, results[0]]), labels)).rejects.toThrow(
      "Duplicate calibration result",
    );
    await expect(auditClassification(iterate(results), [...labels, labels[0]])).rejects.toThrow(
      "Duplicate calibration label",
    );
  });
  it("does not report perfect accuracy when every answer abstains", async () => {
    const { results } = await classify([candidate], [{ ...assessment, contextSufficient: 0.5 }]);
    const report = await auditClassification(iterate(results), [
      {
        assessmentId: classificationAssessmentId(candidate),
        expected: "violation",
        rationale: "Two literal attributes with the same name",
      },
    ]);
    expect(report).toMatchObject({ acceptedAccuracy: null, decisionCoverage: 0, rawCorrect: 1 });
  });
});
