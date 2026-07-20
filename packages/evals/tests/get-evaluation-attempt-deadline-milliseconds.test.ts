import { describe, expect, it } from "vite-plus/test";

import { getEvaluationAttemptDeadlineMilliseconds } from "../src/utils/get-evaluation-attempt-deadline-milliseconds.js";

describe("getEvaluationAttemptDeadlineMilliseconds", () => {
  it("reserves time for every remaining retry attempt", () => {
    const evaluationDeadlineMilliseconds = 28 * 60_000;

    expect(
      getEvaluationAttemptDeadlineMilliseconds({
        evaluationDeadlineMilliseconds,
        attemptIndex: 0,
        totalAttempts: 3,
      }),
    ).toBe(18 * 60_000);
    expect(
      getEvaluationAttemptDeadlineMilliseconds({
        evaluationDeadlineMilliseconds,
        attemptIndex: 1,
        totalAttempts: 3,
      }),
    ).toBe(23 * 60_000);
    expect(
      getEvaluationAttemptDeadlineMilliseconds({
        evaluationDeadlineMilliseconds,
        attemptIndex: 2,
        totalAttempts: 3,
      }),
    ).toBe(evaluationDeadlineMilliseconds);
  });

  it("uses the evaluation deadline when no retries remain", () => {
    expect(
      getEvaluationAttemptDeadlineMilliseconds({
        evaluationDeadlineMilliseconds: 28 * 60_000,
        attemptIndex: 0,
        totalAttempts: 1,
      }),
    ).toBe(28 * 60_000);
  });
});
