import { describe, expect, it, vi } from "vite-plus/test";

import type {
  ClassificationAssessment,
  ClassificationContext,
} from "../src/classification-schema.js";
import { gradeCodeBatch } from "../src/grade-code-batch.js";

const item = {
  id: "duplicate-prop",
  code: 'export const App = () => <div id="a" id="b" />;',
  rule: {
    key: "react-doctor/jsx-no-duplicate-props",
    description: "Do not repeat an explicit JSX attribute name on one element.",
    exceptions: ["Attribute names are case sensitive. Ignore spread attributes."],
  },
};

const violation: ClassificationAssessment = {
  choice: "violation",
  probabilities: { violation: 0.98, valid: 0.01, insufficient_context: 0.01 },
  contextSufficient: 0.99,
  inputTokens: 20,
};
const valid: ClassificationAssessment = {
  ...violation,
  choice: "valid",
  probabilities: { violation: 0.01, valid: 0.98, insufficient_context: 0.01 },
};

describe("gradeCodeBatch", () => {
  it("isolates cyclic and deeply nested inputs before schema traversal", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: unknown = "value";
    for (let depth = 0; depth < 100; depth += 1) deep = { value: deep };
    const evaluate = vi.fn(async () => violation);
    const result = await gradeCodeBatch(
      { items: [{ ...item, project: cyclic }, { ...item, project: deep }, item] },
      { evaluator: { id: "test", evaluate } },
    );
    expect(result.results.map((entry) => entry.verdict)).toEqual(["error", "error", "violation"]);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed provider assessments and ignores malformed cached values", async () => {
    const cache = new Map<string, ClassificationAssessment>();
    const malformed: ClassificationAssessment = { ...violation, contextSufficient: 2 };
    const failed = await gradeCodeBatch(
      { items: [item] },
      {
        cache,
        evaluator: { id: "test", evaluate: async () => malformed },
      },
    );
    expect(failed.results[0].verdict).toBe("error");
    expect(cache.size).toBe(0);
    const assessmentId = failed.results[0].assessmentId;
    if (!assessmentId) throw new Error("Missing assessment ID");
    cache.set(assessmentId, malformed);
    const evaluate = vi.fn(async () => violation);
    const offline = await gradeCodeBatch(
      { items: [item], mode: "offline" },
      {
        cache,
        evaluator: { id: "test", evaluate },
      },
    );
    expect(offline.results[0].verdict).toBe("unavailable");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("compares known detector results and leaves missing results unclassified", async () => {
    const evaluate = vi.fn(async (_context: ClassificationContext) => violation);
    const result = await gradeCodeBatch(
      { items: [{ ...item, detected: true }, { ...item, detected: false }, item] },
      { evaluator: { id: "test", evaluate } },
    );
    expect(result.results.map((entry) => entry.verdict)).toEqual([
      "likely_tp",
      "candidate_fn",
      "violation",
    ]);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0]?.[0]).not.toHaveProperty("detected");
    expect(evaluate.mock.calls[0]?.[0]).not.toHaveProperty("id");
    expect(result.summary.modelCalls).toBe(1);
    const negative = await gradeCodeBatch(
      { items: [{ ...item, detected: true }, { ...item, detected: false }, item] },
      { evaluator: { id: "test", evaluate: async () => valid } },
    );
    expect(negative.results.map((entry) => entry.verdict)).toEqual([
      "candidate_fp",
      "likely_tn",
      "valid",
    ]);
  });

  it("uses cached assessments offline and binds cache keys to code, rules and evaluator", async () => {
    const cache = new Map<string, ClassificationAssessment>();
    const evaluate = vi.fn(async (_context: ClassificationContext) => violation);
    const options = { cache, evaluator: { id: "test", evaluate } };
    await gradeCodeBatch({ items: [item] }, options);
    const result = await gradeCodeBatch(
      {
        mode: "offline",
        items: [
          { ...item, detected: false },
          { ...item, code: "export const App = () => <div />;" },
          { ...item, rule: { ...item.rule, exceptions: [] } },
        ],
      },
      options,
    );
    expect(result.results.map((entry) => entry.verdict)).toEqual([
      "candidate_fn",
      "unavailable",
      "unavailable",
    ]);
    expect(result.summary).toMatchObject({ cached: 1, modelCalls: 0 });
    expect(evaluate).toHaveBeenCalledTimes(1);
    const changedEvaluator = await gradeCodeBatch(
      { mode: "offline", items: [item] },
      {
        cache,
        evaluator: { id: "other", evaluate },
      },
    );
    expect(changedEvaluator.results[0].verdict).toBe("unavailable");
  });

  it("preserves item order and isolates validation and provider failures", async () => {
    const result = await gradeCodeBatch(
      {
        items: [
          null,
          item,
          { ...item, id: "failure", code: "failure" },
          { ...item, line: 20 },
          { ...item, code: " " },
        ],
      },
      {
        evaluator: {
          id: "test",
          evaluate: async (context) => {
            if (context.code === "failure") throw new Error("Provider unavailable");
            return violation;
          },
        },
      },
    );
    expect(result.results.map((entry) => entry.verdict)).toEqual([
      "error",
      "violation",
      "error",
      "error",
      "error",
    ]);
    expect(result.results.map((entry) => entry.index)).toEqual([0, 1, 2, 3, 4]);
    expect(result.results[2].error).toBe("Provider unavailable");
    expect(result.summary.modelCalls).toBe(2);
  });

  it("requires evidence and abstains below either confidence gate", async () => {
    const evaluate = vi.fn(async (_context: ClassificationContext) => violation);
    const missing = await gradeCodeBatch(
      {
        items: [
          { ...item, contextComplete: false },
          { ...item, rule: { ...item.rule, requiredEvidence: ["jsx-runtime"] } },
          { ...item, rule: { ...item.rule, requiredEvidence: ["verified-contract"] } },
        ],
      },
      { evaluator: { id: "test", evaluate } },
    );
    expect(missing.results.every((entry) => entry.verdict === "review")).toBe(true);
    expect(evaluate).not.toHaveBeenCalled();
    for (const assessment of [
      { ...violation, contextSufficient: 0.8 },
      { ...violation, probabilities: { violation: 0.8, valid: 0.1, insufficient_context: 0.1 } },
    ]) {
      const result = await gradeCodeBatch(
        { items: [{ ...item, detected: false }] },
        {
          evaluator: { id: "test", evaluate: async () => assessment },
        },
      );
      expect(result.results[0].verdict).toBe("review");
    }
  });

  it("bounds concurrent calls and retries failures in the next batch", async () => {
    let activeCalls = 0;
    let maxActiveCalls = 0;
    const evaluate = vi.fn(async () => {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await new Promise<void>((resolve) => setImmediate(resolve));
      activeCalls -= 1;
      throw new Error("Retry later");
    });
    const options = {
      cache: new Map<string, ClassificationAssessment>(),
      evaluator: { id: "test", evaluate },
    };
    const input = {
      concurrency: 2,
      items: [item, { ...item, code: "other" }, { ...item, code: "third" }],
    };
    await gradeCodeBatch(input, options);
    expect(maxActiveCalls).toBe(2);
    await gradeCodeBatch({ items: [item] }, options);
    expect(evaluate).toHaveBeenCalledTimes(4);
    expect(options.cache.size).toBe(0);
  });

  it("rejects invalid batch limits before making calls", async () => {
    const evaluate = vi.fn(async (_context: ClassificationContext) => violation);
    for (const input of [
      { items: [] },
      { items: [item], concurrency: 0 },
      { items: Array(101).fill(item) },
    ]) {
      await expect(
        gradeCodeBatch(input, { evaluator: { id: "test", evaluate } }),
      ).rejects.toThrow();
    }
    expect(evaluate).not.toHaveBeenCalled();
  });
});
