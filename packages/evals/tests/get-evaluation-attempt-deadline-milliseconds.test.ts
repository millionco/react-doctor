import { describe, expect, it } from "vite-plus/test";

import { getEvaluationAttemptDeadlineMilliseconds } from "../src/utils/get-evaluation-attempt-deadline-milliseconds.js";

describe("getEvaluationAttemptDeadlineMilliseconds", () => {
  it("caps retry reserves so the active attempt keeps most of a short budget", () => {
    const evaluationDeadlineMilliseconds = 28 * 60_000;

    expect(
      getEvaluationAttemptDeadlineMilliseconds({
        evaluationDeadlineMilliseconds,
        attemptIndex: 0,
        totalAttempts: 3,
        nowMilliseconds: 0,
      }),
    ).toBe(21 * 60_000);
    expect(
      getEvaluationAttemptDeadlineMilliseconds({
        evaluationDeadlineMilliseconds,
        attemptIndex: 1,
        totalAttempts: 3,
        nowMilliseconds: 21 * 60_000,
      }),
    ).toBe(26.25 * 60_000);
    expect(
      getEvaluationAttemptDeadlineMilliseconds({
        evaluationDeadlineMilliseconds,
        attemptIndex: 2,
        totalAttempts: 3,
        nowMilliseconds: 26.25 * 60_000,
      }),
    ).toBe(evaluationDeadlineMilliseconds);
  });

  it("preserves the fixed retry reserve when the remaining budget is large", () => {
    expect(
      getEvaluationAttemptDeadlineMilliseconds({
        evaluationDeadlineMilliseconds: 60 * 60_000,
        attemptIndex: 0,
        totalAttempts: 3,
        nowMilliseconds: 0,
      }),
    ).toBe(50 * 60_000);
  });

  it("uses the evaluation deadline when no retries remain", () => {
    expect(
      getEvaluationAttemptDeadlineMilliseconds({
        evaluationDeadlineMilliseconds: 28 * 60_000,
        attemptIndex: 0,
        totalAttempts: 1,
        nowMilliseconds: 0,
      }),
    ).toBe(28 * 60_000);
  });
});
