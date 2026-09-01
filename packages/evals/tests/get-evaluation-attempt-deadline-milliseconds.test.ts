import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_EVALUATION_MAX_DURATION_MINUTES,
  EVALUATION_CLEANUP_RESERVE_MINUTES,
  EVALUATION_RETRY_CONCURRENCIES,
  MILLISECONDS_PER_MINUTE,
} from "../src/constants.js";
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

  it("pins the default evaluation budget schedule", () => {
    const evaluationDeadlineMilliseconds =
      (DEFAULT_EVALUATION_MAX_DURATION_MINUTES - EVALUATION_CLEANUP_RESERVE_MINUTES) *
      MILLISECONDS_PER_MINUTE;
    const totalAttempts = EVALUATION_RETRY_CONCURRENCIES.length + 1;
    const firstAttemptDeadlineMilliseconds = getEvaluationAttemptDeadlineMilliseconds({
      evaluationDeadlineMilliseconds,
      attemptIndex: 0,
      totalAttempts,
      nowMilliseconds: 0,
    });
    const secondAttemptDeadlineMilliseconds = getEvaluationAttemptDeadlineMilliseconds({
      evaluationDeadlineMilliseconds,
      attemptIndex: 1,
      totalAttempts,
      nowMilliseconds: firstAttemptDeadlineMilliseconds,
    });
    const thirdAttemptDeadlineMilliseconds = getEvaluationAttemptDeadlineMilliseconds({
      evaluationDeadlineMilliseconds,
      attemptIndex: 2,
      totalAttempts,
      nowMilliseconds: secondAttemptDeadlineMilliseconds,
    });

    expect(firstAttemptDeadlineMilliseconds).toBe(32.25 * MILLISECONDS_PER_MINUTE);
    expect(secondAttemptDeadlineMilliseconds).toBe(40.3125 * MILLISECONDS_PER_MINUTE);
    expect(thirdAttemptDeadlineMilliseconds).toBe(42.328125 * MILLISECONDS_PER_MINUTE);
    expect(
      getEvaluationAttemptDeadlineMilliseconds({
        evaluationDeadlineMilliseconds,
        attemptIndex: 3,
        totalAttempts,
        nowMilliseconds: thirdAttemptDeadlineMilliseconds,
      }),
    ).toBe(evaluationDeadlineMilliseconds);
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
