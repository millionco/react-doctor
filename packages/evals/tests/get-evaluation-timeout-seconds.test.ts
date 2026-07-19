import { describe, expect, it } from "vite-plus/test";

import { getEvaluationTimeoutSeconds } from "../src/utils/get-evaluation-timeout-seconds.js";

describe("getEvaluationTimeoutSeconds", () => {
  it("bounds a command timeout by the remaining evaluation budget", () => {
    expect(
      getEvaluationTimeoutSeconds({
        deadlineMilliseconds: 11_000,
        maximumTimeoutSeconds: 30,
        nowMilliseconds: 1_000,
      }),
    ).toBe(10);
  });

  it("keeps the command-specific timeout when the budget is larger", () => {
    expect(
      getEvaluationTimeoutSeconds({
        deadlineMilliseconds: 61_000,
        maximumTimeoutSeconds: 5,
        nowMilliseconds: 1_000,
      }),
    ).toBe(5);
  });

  it("rejects new work after the evaluation budget is exhausted", () => {
    expect(() =>
      getEvaluationTimeoutSeconds({
        deadlineMilliseconds: 1_000,
        maximumTimeoutSeconds: 5,
        nowMilliseconds: 1_000,
      }),
    ).toThrow("budget exhausted");
  });
});
